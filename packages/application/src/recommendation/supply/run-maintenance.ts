/*
 * Runs one bounded maintenance round: evaluate both pools, reuse saved
 * analyses, search only where gaps remain, match what is already analyzed, and
 * prune what no purpose keeps. Waiting requests are given a chance to finish
 * after every commit, so a satisfied caller never waits for the whole round.
 */
import type { Api, Model } from '@megumi/ai';
import type { DatabaseConnection } from '../../storage/index';
import type { Observability } from '../../observability/index';
import type { TextModelClient } from '../call-text-model';
import {
  evaluatePool,
  qualifyMatchedContent,
  retireExitedCandidates,
  type PoolEvaluation,
} from '../candidates/evaluate-candidates';
import { matchPendingInterests } from '../candidates/match-interests';
import type { CandidatePool, SupplyHealth } from '../candidates/candidate-contracts';
import type { CandidateStorage } from '../candidates/candidate-storage';
import { intakeContent } from '../content/intake-content';
import { analyzeContent, type AnalysisInterest, type AnalysisRequestEstimate } from '../content/analyze-content';
import type { ContentStorage } from '../content/content-storage';
import { pruneUnusedContent } from '../content/prune-content';
import { screenDiscoveries } from '../content/screen-discoveries';
import { executePlannedSearch, type PlannedSearch, type StoredDiscovery } from '../discovery/execute-searches';
import { needsSearchPlanning, planSearches, type PendingGap } from '../discovery/plan-searches';
import type { SearchStorage } from '../discovery/search-storage';
import type { InterestManagement } from '../interests/interest-contracts';
import type { SourceConnector } from '../sources/source-connector';
import type { ExecutionBudget } from './execution-budget';
import type {
  CandidateRequirement,
  ContentRetentionReader,
  MaintenanceCounts,
  MaintenanceResult,
  StopReason,
  SupplyIssue,
  UsageReader,
} from './supply-contracts';
import type { SupplyExecutionConfig } from './read-supply-config';

const POOLS: readonly CandidatePool[] = ['daily', 'long_term'];

export interface MaintenanceDependencies {
  readonly config: SupplyExecutionConfig;
  readonly database: DatabaseConnection;
  readonly model: Model<Api>;
  /** Connectors for the enabled sources; a plan item picks one by id. */
  readonly sources: readonly SourceConnector[];
  readonly client: TextModelClient;
  readonly interests: InterestManagement;
  readonly contents: ContentStorage;
  readonly candidates: CandidateStorage;
  readonly search: SearchStorage;
  readonly usage: UsageReader;
  readonly retention: ContentRetentionReader;
  /** Problems found while assembling the round, reported with its result. */
  readonly configIssues?: readonly SupplyIssue[];
  /** Platform identifiers are minted by the caller so ids stay unique per round. */
  readonly newId: (prefix: string) => string;
  readonly now: () => number;
  readonly observability?: Observability;
}

export interface MaintenanceRunInput {
  readonly trigger: 'startup' | 'periodic';
  readonly budget: ExecutionBudget;
  readonly signal: AbortSignal;
  /** Called after each commit so waiting requests can be satisfied early. */
  readonly deliver: () => Promise<void>;
  /** Generation requests still waiting, so their gaps drive this round. */
  readonly pendingRequirements: () => readonly CandidateRequirement[];
}

/**
 * Performs one round. Every external step is charged to the shared budget, and
 * a cancelled or expired round stops starting new work while keeping whatever
 * was already committed.
 */
export async function runMaintenance(
  dependencies: MaintenanceDependencies,
  input: MaintenanceRunInput,
): Promise<MaintenanceResult> {
  const issues: SupplyIssue[] = [...(dependencies.configIssues ?? [])];
  const savedCounts: MaintenanceCounts = {
    discoveredItems: 0,
    screenedOutItems: 0,
    normalizedContents: 0,
    analyzedContents: 0,
    newCandidates: 0,
  };
  const snapshot = await dependencies.interests.listInterests();
  const interests = snapshot.interests.filter((interest) => interest.enabled);

  if (interests.length === 0) {
    return finish(dependencies, input, savedCounts, issues, [], 'no_work');
  }

  const usage = new Map<CandidatePool, Awaited<ReturnType<UsageReader['readUsageSnapshot']>>>();
  for (const pool of POOLS) usage.set(pool, await dependencies.usage.readUsageSnapshot(pool));

  let evaluations = await evaluateAll(dependencies, interests, usage);

  // Reuse whatever an earlier process left unfinished before spending the round
  // on new work: retry what is due, judge saved analyses for the current
  // interests, and commit the pool relations that judgement already justifies.
  const leftoverAnalyses = dependencies.contents.listPendingAnalyses({
    limit: dependencies.config.limits.maxAnalysisCalls,
    maxAttempts: dependencies.config.limits.maxRetryAttempts,
  });
  await resumePendingWork(dependencies, input, leftoverAnalyses, savedCounts, issues);

  const matched = await matchPendingInterests(
    {
      client: dependencies.client,
      contents: dependencies.contents,
      candidates: dependencies.candidates,
      ...(dependencies.observability ? { observability: dependencies.observability } : {}),
    },
    {
      interests,
      model: dependencies.model,
      callBudget: input.budget.remaining('matchingCalls'),
      maxInputTokens: dependencies.config.limits.maxRequestInputTokens,
      maxOutputTokens: dependencies.config.limits.maxRequestOutputTokens,
      reserveMatchingCall: () =>
        input.budget.reserve('matchingCalls') &&
        input.budget.reserveModelTokens({
          inputTokens: dependencies.config.limits.maxRequestInputTokens,
          outputTokens: dependencies.config.limits.maxRequestOutputTokens,
        }),
      now: dependencies.now(),
      signal: input.signal,
    },
  );
  if (matched.status === 'failed') {
    issues.push({ stage: 'matching', code: matched.code, message: matched.message });
  }
  const qualified = qualifyMatchedContent(
    { database: dependencies.database, candidates: dependencies.candidates },
    {
      limit: dependencies.config.limits.maxAnalysisCalls,
      freshnessDays: dependencies.config.freshnessDays,
      now: dependencies.now(),
    },
  );
  savedCounts.newCandidates += qualified.committedPools.length;
  await input.deliver();

  evaluations = await evaluateAll(dependencies, interests, usage);
  // Tidy only after qualification is settled, so a relation that just became
  // valid is never mistaken for one that exited.
  for (const pool of POOLS) {
    retireExitedCandidates(
      { database: dependencies.database, candidates: dependencies.candidates },
      {
        pool,
        freshnessDays: dependencies.config.freshnessDays,
        now: dependencies.now(),
      },
    );
  }
  await pruneUnusedContent(
    {
      database: dependencies.database,
      contents: dependencies.contents,
      candidates: dependencies.candidates,
      retention: dependencies.retention,
    },
    { batchSize: 50 },
  );

  const poolHealth: SupplyHealth[] = [
    ...evaluations.map((evaluation) => evaluation.health),
    ...evaluations.flatMap((evaluation) => evaluation.interestHealth),
  ];
  // A waiting generation request drives planning even when every pool is above
  // its minimum, so its own gaps are the round's highest priority.
  const pendingGaps = pendingRequirementGaps(input.pendingRequirements(), evaluations);

  // A cancelled or expired round starts no further model request.
  const canPlan =
    !input.signal.aborted &&
    !input.budget.expired &&
    needsSearchPlanning({ poolHealth, hasPendingRequest: pendingGaps.length > 0 });

  if (canPlan) {
    // Planning is counted work: reserve its call and its tokens before asking.
    if (
      input.budget.reserve('planningCalls') &&
      input.budget.reserveModelTokens({
        inputTokens: dependencies.config.limits.maxRequestInputTokens,
        outputTokens: dependencies.config.limits.maxRequestOutputTokens,
      })
    ) {
    const planned = await planSearches(
      {
        database: dependencies.database,
        client: dependencies.client,
        ...(dependencies.observability ? { observability: dependencies.observability } : {}),
      },
      {
        interests,
        poolHealth,
        pendingGaps,
        recentSearches: dependencies.search.listRecentSearches({
          since: dependencies.now() - dependencies.config.searchHistoryDays * 24 * 60 * 60 * 1_000,
        }),
        // Only sources with an assembled connector may be planned.
        sources: dependencies.sources.map((source) => source.descriptor),
        model: dependencies.model,
        maxInputTokens: dependencies.config.limits.maxRequestInputTokens,
        maxOutputTokens: dependencies.config.limits.maxRequestOutputTokens,
        maxResultsPerSearch: dependencies.config.limits.maxResultsPerSearch,
        // A plan may only contain searches the remaining round budget can pay for.
        maxItems: input.budget.remaining('searchCalls'),
        now: dependencies.now(),
        freshnessDays: dependencies.config.freshnessDays,
        signal: input.signal,
      },
    );

    if (planned.status === 'planned') {
      // A plan the program refused is a reported gap, not a silent empty round.
      if (planned.invalidItems > 0) {
        issues.push({
          stage: 'search',
          code: 'plan_items_invalid',
          message: `${planned.invalidItems} planned searches were refused because they named an unknown interest, an unknown source, an unknown stored query, or no query expression.`,
        });
      }
      await consumePlan(dependencies, input, planned.items, savedCounts, issues);
    } else {
      issues.push({
        stage: 'search',
        code: planned.code,
        message: `Search planning failed: ${planned.message}`,
      });
    }
    } else {
      issues.push({
        stage: 'search',
        code: 'BUDGET_EXHAUSTED',
        message: 'The round has no planning budget left for this search plan.',
      });
    }
  }

  await input.deliver();
  evaluations = await evaluateAll(dependencies, interests, usage);
  return finish(
    dependencies,
    input,
    savedCounts,
    issues,
    evaluations.map((evaluation) => evaluation.health),
    stopReasonFor(dependencies, input, evaluations),
  );
}

/** Runs each planned search, screens what it discovered, and intakes the rest. */
async function consumePlan(
  dependencies: MaintenanceDependencies,
  input: MaintenanceRunInput,
  items: readonly PlannedSearch[],
  savedCounts: MaintenanceCounts,
  issues: SupplyIssue[],
): Promise<void> {
  const interests = (await dependencies.interests.listInterests()).interests.filter(
    (interest) => interest.enabled,
  );
  const enabledInterests = new Set(interests.map((interest) => interest.id));
  for (const item of items) {
    if (input.signal.aborted || input.budget.expired) return;
    // The requirement may have changed between planning and execution; a
    // changed interest never starts a new search.
    if (!enabledInterests.has(item.interestId)) continue;
    const source = dependencies.sources.find((candidate) => candidate.id === item.source);
    // Planning only accepts sources that have a connector, so this is a contract
    // violation rather than a gap the round can report.
    if (!source) throw new Error(`No connector is assembled for planned source ${item.source}.`);
    const outcome = await executePlannedSearch(
      {
        database: dependencies.database,
        source,
        storage: dependencies.search,
        budget: input.budget,
        newQueryId: () => dependencies.newId('query'),
        newResultId: () => dependencies.newId('result'),
        newHistoryId: () => dependencies.newId('history'),
        reuseIntervalMs: dependencies.config.searchReuseIntervalMinutes * 60 * 1_000,
        cooldownMs: dependencies.config.limits.sourceCooldownSeconds * 1_000,
      },
      { ...item, now: dependencies.now(), signal: input.signal },
    );
    if (outcome.status === 'failed') {
      issues.push({ stage: 'search', code: outcome.code, subjectId: item.interestId, message: outcome.message });
      continue;
    }
    if (outcome.status === 'skipped') continue;

    savedCounts.discoveredItems += outcome.resultCount;
    const screened = await screenBatch(
      dependencies,
      input,
      interests,
      outcome.items,
      savedCounts,
      issues,
    );
    if (screened.status === 'deferred') return;
    for (const verdict of screened.verdicts) {
      if (input.signal.aborted || input.budget.expired) return;
      await intake(dependencies, input, verdict.discovery, interests, verdict.screenedOut, savedCounts, issues);
    }
    await input.deliver();
  }
}

/**
 * Judges one search's or one resume batch's discoveries for relevance before any
 * full analysis. A failed call keeps every discovery, and an exhausted screening
 * budget stops the work instead of letting it skip the screen: the remaining
 * discoveries stay pending for a later round.
 *
 * The returned list holds every discovery the round must still process, each with
 * the screening exclusion the analysis has to honour.
 */
async function screenBatch(
  dependencies: MaintenanceDependencies,
  input: MaintenanceRunInput,
  interests: readonly AnalysisInterest[],
  discoveries: readonly StoredDiscovery[],
  savedCounts: MaintenanceCounts,
  issues: SupplyIssue[],
): Promise<{ status: 'continue'; verdicts: readonly DiscoveryVerdict[] } | { status: 'deferred' }> {
  // Nothing to judge: every discovery goes to the full analysis on its own merits.
  const bySelf = (): { status: 'continue'; verdicts: readonly DiscoveryVerdict[] } => ({
    status: 'continue',
    verdicts: discoveries.map((discovery) => ({ discovery, screenedOut: false })),
  });
  if (discoveries.length === 0) return bySelf();

  const outcome = await screenDiscoveries(
    {
      client: dependencies.client,
      contents: dependencies.contents,
      ...(dependencies.observability ? { observability: dependencies.observability } : {}),
    },
    {
      items: discoveries,
      interests,
      model: dependencies.model,
      contentLanguages: dependencies.config.contentLanguages,
      maxInputTokens: dependencies.config.limits.maxRequestInputTokens,
      maxOutputTokens: dependencies.config.limits.maxRequestOutputTokens,
      // A batch never holds more items than the search that produced them could.
      maxBatchItems: dependencies.config.limits.maxResultsPerSearch,
      reserveScreening: (estimate) =>
        input.budget.reserveModelTokens(estimate) && input.budget.reserve('screeningCalls'),
      now: dependencies.now(),
      signal: input.signal,
    },
  );
  if (outcome.status === 'failed') {
    // A screening problem never discards discoveries: the batch keeps all of them.
    issues.push({
      stage: 'screening',
      code: outcome.code,
      subjectId: discoveries[0]?.resultId,
      message: `Relevance screening failed, so its ${discoveries.length} discoveries were kept for analysis: ${outcome.message}`,
    });
    return bySelf();
  }
  if (outcome.deferred) return { status: 'deferred' };

  // The batch order decides the intake order, so screening never reorders work.
  const kept = new Map(outcome.decisions.map((decision) => [decision.resultId, decision.keep]));
  const verdicts = discoveries.map((discovery) => ({
    discovery,
    // A discovery no verdict names is kept: the model must not exclude it.
    screenedOut: kept.get(discovery.resultId) === false,
  }));
  savedCounts.screenedOutItems += verdicts.filter((verdict) => verdict.screenedOut).length;
  return { status: 'continue', verdicts };
}

/** One discovery the round still has to process, with the screening exclusion to honour. */
interface DiscoveryVerdict {
  readonly discovery: StoredDiscovery;
  readonly screenedOut: boolean;
}

/** Brings one discovery through analysis and the first candidate commit. */
async function intake(
  dependencies: MaintenanceDependencies,
  input: MaintenanceRunInput,
  discovery: StoredDiscovery,
  interests: readonly AnalysisInterest[],
  /** True when relevance screening excluded this discovery from the analysis. */
  screenedOut: boolean,
  savedCounts: MaintenanceCounts,
  issues: SupplyIssue[],
): Promise<string | undefined> {
  if (interests.length === 0) return 'interest_changed';

  const intakeInput = {
    item: discovery.item,
    sourceResultId: discovery.resultId,
    interests,
    model: dependencies.model,
    contentLanguages: dependencies.config.contentLanguages,
    maxInputTokens: dependencies.config.limits.maxRequestInputTokens,
    maxOutputTokens: dependencies.config.limits.maxRequestOutputTokens,
    freshnessDays: dependencies.config.freshnessDays,
    analysisRetryAt: (failureCode: string) => retryAtFor(dependencies, failureCode),
    reserveAnalysis: (estimate: AnalysisRequestEstimate) =>
      input.budget.reserveModelTokens(estimate) && input.budget.reserve('analysisCalls'),
    screenedOut,
    now: dependencies.now(),
    signal: input.signal,
  };
  const outcome = await intakeContent(
    {
      client: dependencies.client,
      contents: dependencies.contents,
      candidates: dependencies.candidates,
      newContentId: () => dependencies.newId('content'),
      ...(dependencies.observability ? { observability: dependencies.observability } : {}),
    },
    intakeInput,
  );

  switch (outcome.status) {
    case 'deferred':
      // The round had no budget left; the discovery stays pending for later.
      return 'budget';
    case 'candidate':
      savedCounts.normalizedContents += 1;
      savedCounts.analyzedContents += 1;
      savedCounts.newCandidates += outcome.committedPools.length;
      return undefined;
    case 'failed':
      issues.push({
        stage: outcome.code === 'MATERIAL_TOO_LONG' ? 'material' : 'analysis',
        code: outcome.code,
        subjectId: discovery.resultId,
        message: outcome.message,
      });
      return outcome.code;
    case 'rejected':
      // Rejected material stays rejected: a retry would read the same text.
      issues.push({
        stage: 'material',
        code: outcome.reason,
        subjectId: discovery.resultId,
        message: outcome.message,
      });
      return undefined;
    default:
      return undefined;
  }
}

/**
 * Resumes work an earlier process left unfinished: discoveries saved but never
 * normalized, pending analyses a previous round never finished, and analyses
 * that failed and are due. All of it follows persisted state, never an
 * in-memory queue or a Trace. Each item is retried only while it is under the
 * configured attempt limit.
 */
async function resumePendingWork(
  dependencies: MaintenanceDependencies,
  input: MaintenanceRunInput,
  leftoverAnalyses: readonly string[],
  savedCounts: MaintenanceCounts,
  issues: SupplyIssue[],
): Promise<void> {
  const maxAttempts = dependencies.config.limits.maxRetryAttempts;
  const dueDiscoveries = dependencies.search.listDueDiscoveries({
    limit: dependencies.config.limits.maxAnalysisCalls,
    now: dependencies.now(),
    maxAttempts,
  });
  // Leftover discoveries are screened as one batch too, so a discovery an earlier
  // round never judged is not analyzed without a verdict either.
  const interests = (await dependencies.interests.listInterests()).interests.filter(
    (interest) => interest.enabled,
  );
  const screened = await screenBatch(
    dependencies,
    input,
    interests,
    dueDiscoveries,
    savedCounts,
    issues,
  );
  if (screened.status === 'deferred') return;
  for (const verdict of screened.verdicts) {
    if (input.signal.aborted || input.budget.expired) return;
    const failure = await intake(
      dependencies,
      input,
      verdict.discovery,
      interests,
      verdict.screenedOut,
      savedCounts,
      issues,
    );
    if (failure !== undefined && isRetryableFailure(failure)) {
      dependencies.search.scheduleDiscoveryRetry({
        resultId: verdict.discovery.resultId,
        retryAt: dependencies.now() + dependencies.config.limits.retryIntervalSeconds * 1_000,
        errorCode: failure,
      });
    }
    await input.deliver();
  }

  const dueAnalyses = dependencies.contents.listAnalysesDueForRetry({
    limit: dependencies.config.limits.maxAnalysisCalls,
    now: dependencies.now(),
    maxAttempts,
  });
  for (const contentId of [...new Set([...dueAnalyses, ...leftoverAnalyses])]) {
    if (input.signal.aborted || input.budget.expired) return;
    if (!input.budget.reserve('analysisCalls')) return;
    // An attempt in flight is pending, so the retry limit counts every attempt.
    dependencies.contents.markAnalysisRetrying({ contentId });
    const failure = await reanalyze(dependencies, input, contentId);
    if (failure !== undefined) {
      const retryAt = retryAtFor(dependencies, failure);
      dependencies.contents.markAnalysisFailure({
        contentId,
        ...(retryAt !== undefined ? { retryAt } : {}),
        errorCode: failure,
      });
    }
    await input.deliver();
  }
}

/** The gap each waiting generation request still has, as this round reads it. */
function pendingRequirementGaps(
  requirements: readonly CandidateRequirement[],
  evaluations: readonly PoolEvaluation[],
): PendingGap[] {
  const gaps: PendingGap[] = [];
  for (const requirement of requirements) {
    const evaluation = evaluations.find((entry) => entry.snapshot.pool === requirement.pool);
    if (!evaluation) continue;
    const total = evaluation.snapshot.counts.total;
    if (total < requirement.minimumCount) {
      gaps.push({ pool: requirement.pool, missing: requirement.minimumCount - total });
    }
    for (const coverage of requirement.coverage) {
      const count =
        evaluation.snapshot.counts.byInterest.find(
          (entry) => entry.interestId === coverage.interestId,
        )?.count ?? 0;
      if (count < coverage.minimumCount) {
        gaps.push({
          pool: requirement.pool,
          interestId: coverage.interestId,
          missing: coverage.minimumCount - count,
        });
      }
    }
  }
  return gaps;
}

/** The retry time for a failure, or `undefined` when another attempt cannot help. */
function retryAtFor(dependencies: MaintenanceDependencies, failureCode: string): number | undefined {
  return isRetryableFailure(failureCode)
    ? dependencies.now() + dependencies.config.limits.retryIntervalSeconds * 1_000
    : undefined;
}

/** Retries the text analysis for content whose earlier attempt failed. */
async function reanalyze(
  dependencies: MaintenanceDependencies,
  input: MaintenanceRunInput,
  contentId: string,
): Promise<string | undefined> {
  const content = dependencies.contents.findById(contentId);
  if (!content) return undefined;
  const interests = (await dependencies.interests.listInterests()).interests.filter(
    (entry) => entry.enabled,
  );
  if (interests.length === 0) return undefined;

  const analyzed = await analyzeContent(
    dependencies.client,
    {
      contentId,
      text: content.text,
      ...(content.title ? { title: content.title } : {}),
      interests,
      model: dependencies.model,
      maxInputTokens: dependencies.config.limits.maxRequestInputTokens,
      maxOutputTokens: dependencies.config.limits.maxRequestOutputTokens,
      signal: input.signal,
    },
    dependencies.observability ? { observability: dependencies.observability } : {},
  );
  if (analyzed.status !== 'analyzed') {
    return analyzed.status === 'material_too_long' ? 'MATERIAL_TOO_LONG' : analyzed.code;
  }

  dependencies.contents.saveAnalysisResult({
    contentId,
    result: analyzed.analysis,
    now: dependencies.now(),
  });
  dependencies.candidates.commitRelations({
    contentId,
    matches: analyzed.matches.map((match) => ({
      interestId: match.interestId,
      expectedText: interests.find((entry) => entry.id === match.interestId)?.text ?? '',
      relation: match.relation,
      ...(match.basis ? { basis: match.basis } : {}),
    })),
    pools: [],
    now: dependencies.now(),
  });
  return undefined;
}

/** Only transport and result-shape failures are worth another attempt. */
function isRetryableFailure(code: string): boolean {
  return code === 'TRANSPORT' || code === 'INVALID_RESULT' || code === 'rate_limited';
}

async function evaluateAll(
  dependencies: MaintenanceDependencies,
  interests: readonly { readonly id: string; readonly text: string; readonly enabled: boolean }[],
  usage: ReadonlyMap<CandidatePool, { readonly revision: string; readonly excludedContentIds: readonly string[] }>,
): Promise<PoolEvaluation[]> {
  const evaluations: PoolEvaluation[] = [];
  for (const pool of POOLS) {
    const poolUsage = usage.get(pool);
    if (!poolUsage) continue;
    evaluations.push(
      evaluatePool(
        { database: dependencies.database, candidates: dependencies.candidates },
        {
          pool,
          interests,
          usage: { revision: poolUsage.revision, excludedContentIds: [...poolUsage.excludedContentIds] },
          requirement: { pool, minimumCount: 1, coverage: [] },
          thresholds: pool === 'daily' ? dependencies.config.daily : dependencies.config.longTerm,
          freshnessDays: dependencies.config.freshnessDays,
          searchHistoryDays: dependencies.config.searchHistoryDays,
          now: dependencies.now(),
        },
      ),
    );
  }
  return evaluations;
}

function stopReasonFor(
  dependencies: MaintenanceDependencies,
  input: MaintenanceRunInput,
  evaluations: readonly PoolEvaluation[],
): StopReason {
  if (input.signal.aborted) return 'cancelled';
  if (input.budget.expired) return 'deadline';
  const health = evaluations.map((evaluation) => evaluation.health);
  if (health.every((entry) => entry.targetDeficit === 0)) return 'targets_met';
  if (health.every((entry) => entry.minimumDeficit === 0)) return 'minimums_met';
  return dependencies.candidates.listContentsMissingMatches({ limit: 1 }).length > 0
    ? 'minimums_met'
    : 'sources_exhausted';
}

/** Stops the round, records the checkpoint, and reports what actually happened. */
function finish(
  dependencies: MaintenanceDependencies,
  input: MaintenanceRunInput,
  savedCounts: MaintenanceCounts,
  issues: SupplyIssue[],
  poolHealth: readonly SupplyHealth[],
  stopReason: StopReason,
): MaintenanceResult {
  dependencies.search.writeCheckpoint({
    lastFinishedAt: dependencies.now(),
    now: dependencies.now(),
  });
  return {
    status: input.signal.aborted ? 'cancelled' : 'completed',
    stopReason,
    savedCounts,
    poolHealth: [...poolHealth],
    issues,
  };
}
