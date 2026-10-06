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
import { evaluatePool, type PoolEvaluation } from '../candidates/evaluate-candidates';
import { matchPendingInterests } from '../candidates/match-interests';
import type { CandidatePool, SupplyHealth } from '../candidates/candidate-contracts';
import type { CandidateStorage } from '../candidates/candidate-storage';
import { intakeContent } from '../content/intake-content';
import { analyzeContent } from '../content/analyze-content';
import type { ContentStorage } from '../content/content-storage';
import { pruneUnusedContent } from '../content/prune-content';
import { executePlannedSearch, type PlannedSearch, type StoredDiscovery } from '../discovery/execute-searches';
import { needsSearchPlanning, planSearches } from '../discovery/plan-searches';
import type { SearchStorage } from '../discovery/search-storage';
import type { InterestManagement } from '../interests/interest-contracts';
import type { SourceConnector } from '../sources/source-connector';
import type { ExecutionBudget } from './execution-budget';
import type {
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
  readonly source: SourceConnector;
  readonly client: TextModelClient;
  readonly interests: InterestManagement;
  readonly contents: ContentStorage;
  readonly candidates: CandidateStorage;
  readonly search: SearchStorage;
  readonly usage: UsageReader;
  readonly retention: ContentRetentionReader;
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
  const issues: SupplyIssue[] = [];
  const savedCounts: MaintenanceCounts = {
    discoveredItems: 0,
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
  await pruneUnusedContent(
    { database: dependencies.database, contents: dependencies.contents, retention: dependencies.retention },
    { batchSize: 50 },
  );
  // Resume whatever an earlier process left unfinished before planning new work.
  await resumePendingWork(dependencies, input, evaluations, savedCounts, issues);

  const poolHealth = evaluations.map((evaluation) => evaluation.health);
  const hasGap = evaluations.some(
    (evaluation) =>
      evaluation.health.minimumDeficit > 0 ||
      evaluation.interestHealth.some((health) => health.minimumDeficit > 0),
  );

  if (hasGap && needsSearchPlanning({ poolHealth, hasPendingRequest: false, interestsChanged: false })) {
    const planned = await planSearches(
      {
        database: dependencies.database,
        client: dependencies.client,
        ...(dependencies.observability ? { observability: dependencies.observability } : {}),
      },
      {
        interests,
        poolHealth,
        recentSearches: dependencies.search.listRecentSearches({
          since: dependencies.now() - dependencies.config.searchHistoryDays * 24 * 60 * 60 * 1_000,
        }),
        sources: ['zhihu'],
        model: dependencies.model,
        maxInputTokens: dependencies.config.limits.maxRequestInputTokens,
        maxOutputTokens: dependencies.config.limits.maxRequestOutputTokens,
        maxResultsPerSearch: dependencies.config.limits.maxResultsPerSearch,
        maxItems: dependencies.config.limits.maxPlanningCalls,
        signal: input.signal,
      },
    );

    if (planned.status === 'planned') {
      await consumePlan(dependencies, input, planned.items, evaluations, savedCounts, issues);
    } else {
      issues.push({
        stage: 'search',
        code: planned.code,
        message: `Search planning failed: ${planned.message}`,
      });
    }
  }

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
      batchSize: dependencies.config.limits.maxAnalysisCalls,
      maxInputTokens: dependencies.config.limits.maxRequestInputTokens,
      maxOutputTokens: dependencies.config.limits.maxRequestOutputTokens,
      now: dependencies.now(),
      signal: input.signal,
    },
  );
  if (matched.status === 'failed') {
    issues.push({ stage: 'matching', code: matched.code, message: matched.message });
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

/** Runs each planned search and intakes whatever it discovered. */
async function consumePlan(
  dependencies: MaintenanceDependencies,
  input: MaintenanceRunInput,
  items: readonly PlannedSearch[],
  evaluations: readonly PoolEvaluation[],
  savedCounts: MaintenanceCounts,
  issues: SupplyIssue[],
): Promise<void> {
  for (const item of items) {
    if (input.signal.aborted || input.budget.expired) return;
    const outcome = await executePlannedSearch(
      {
        database: dependencies.database,
        source: dependencies.source,
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
    for (const discovery of outcome.items) {
      if (input.signal.aborted || input.budget.expired) return;
      await intake(dependencies, input, discovery, item.interestId, evaluations, savedCounts, issues);
    }
    await input.deliver();
  }
}

/** Brings one discovery through analysis and the first candidate commit. */
async function intake(
  dependencies: MaintenanceDependencies,
  input: MaintenanceRunInput,
  discovery: StoredDiscovery,
  interestId: string,
  evaluations: readonly PoolEvaluation[],
  savedCounts: MaintenanceCounts,
  issues: SupplyIssue[],
): Promise<string | undefined> {
  if (!input.budget.reserve('analysisCalls')) return 'budget';
  const interests = (await dependencies.interests.listInterests()).interests.filter(
    (entry) => entry.enabled,
  );
  if (!interests.some((entry) => entry.id === interestId)) return 'interest_changed';
  const expiresAt = expiresAtFor(discovery, dependencies);

  const outcome = await intakeContent(
    {
      client: dependencies.client,
      contents: dependencies.contents,
      candidates: dependencies.candidates,
      newContentId: () => dependencies.newId('content'),
      ...(dependencies.observability ? { observability: dependencies.observability } : {}),
    },
    {
      item: discovery.item,
      sourceResultId: discovery.resultId,
      interests,
      model: dependencies.model,
      contentLanguages: dependencies.config.contentLanguages,
      maxInputTokens: dependencies.config.limits.maxRequestInputTokens,
      maxOutputTokens: dependencies.config.limits.maxRequestOutputTokens,
      pool: poolFor(discovery, evaluations),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      now: dependencies.now(),
      signal: input.signal,
    },
  );

  switch (outcome.status) {
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
 * normalized, and analyses that failed and are due for another attempt. Both
 * follow persisted state, never an in-memory queue or a Trace.
 */
async function resumePendingWork(
  dependencies: MaintenanceDependencies,
  input: MaintenanceRunInput,
  evaluations: readonly PoolEvaluation[],
  savedCounts: MaintenanceCounts,
  issues: SupplyIssue[],
): Promise<void> {
  const retryAt = dependencies.now() + dependencies.config.limits.retryIntervalSeconds * 1_000;
  const dueDiscoveries = dependencies.search.listDueDiscoveries({
    limit: dependencies.config.limits.maxAnalysisCalls,
    now: dependencies.now(),
  });
  if (dueDiscoveries.length > 0) {
    const enabled = (await dependencies.interests.listInterests()).interests.filter(
      (entry) => entry.enabled,
    );
    const interestId = enabled[0]?.id;
    if (interestId) {
      for (const discovery of dueDiscoveries) {
        if (input.signal.aborted || input.budget.expired) return;
        const failure = await intake(
          dependencies,
          input,
          discovery,
          interestId,
          evaluations,
          savedCounts,
          issues,
        );
        if (failure !== undefined && isRetryableFailure(failure)) {
          dependencies.search.scheduleDiscoveryRetry({
            resultId: discovery.resultId,
            retryAt,
            errorCode: failure,
          });
        }
        await input.deliver();
      }
    }
  }

  const dueAnalyses = dependencies.contents.listAnalysesDueForRetry({
    limit: dependencies.config.limits.maxAnalysisCalls,
    now: dependencies.now(),
  });
  for (const contentId of dueAnalyses) {
    if (input.signal.aborted || input.budget.expired) return;
    if (!input.budget.reserve('analysisCalls')) return;
    const failure = await reanalyze(dependencies, input, contentId);
    if (failure !== undefined && isRetryableFailure(failure)) {
      dependencies.contents.markAnalysisFailure({ contentId, retryAt, errorCode: failure });
    }
    await input.deliver();
  }
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

/** The pool a fresh discovery should qualify for; the longer-lived one wins. */
function poolFor(discovery: StoredDiscovery, evaluations: readonly PoolEvaluation[]): CandidatePool {
  const longTerm = evaluations.some((evaluation) => evaluation.snapshot.pool === 'long_term');
  return longTerm && discovery.item.publishedAt === undefined ? 'long_term' : 'daily';
}

function expiresAtFor(discovery: StoredDiscovery, dependencies: MaintenanceDependencies): number | undefined {
  const publishedAt = discovery.item.publishedAt;
  if (publishedAt === undefined) return undefined;
  return publishedAt + dependencies.config.freshnessDays * 24 * 60 * 60 * 1_000;
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
