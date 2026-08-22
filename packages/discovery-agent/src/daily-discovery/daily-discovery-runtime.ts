/* Owns daily preflight, one background Agent Execution, bounded discovery Tools and publication. */
import { Agent, type AgentTool } from '@megumi/agent';
import { Type, type Api, type Model, type Models } from '@megumi/ai';
import {
  createCandidateRegistry,
  discoveryContentIdentity,
  type DiscoveryCandidate,
} from './candidate-registry';
import {
  EnsureDailyDiscoveryRequestSchema,
  type EnsureDailyDiscoveryRequest,
  type EnsureDailyDiscoveryResult,
} from './daily-discovery';
import type { Interest } from '../interests/interest';
import type {
  DiscoveryRepository,
  RecommendationSelectionSignal,
} from '../persistence/discovery-repository';
import type { Recommendation } from '../recommendations/recommendation';
import type { UpdateRecommendationStateRequest } from '../recommendations/recommendation';
import type {
  DiscoveryHomeView,
  GetDiscoveryHomeRequest,
  RecommendationView,
  SearchRecommendationsRequest,
  SearchRecommendationsResult,
} from '../discovery-view';
import type {
  DiscoverySourceId,
  SourceContent,
  SourceDescriptor,
  SourceFailure,
  SourceSearchMode,
} from '../sources/discovery-source';
import type { SourceRegistry } from '../sources/source-registry';

const MAX_SEARCH_CALLS = 12;
const MAX_CANDIDATES = 200;
const MAX_READ_CALLS = 40;

export interface CreateDailyDiscoveryRuntimeOptions {
  readonly repository: DiscoveryRepository;
  readonly sourceRegistry: SourceRegistry;
  readonly settings: {
    getDiscoverySettings(): {
      readonly dailyGenerationTime: string;
      readonly dailyTargetCount: number;
      readonly enabledSources: readonly DiscoverySourceId[];
    };
  };
  readonly timezone: () => string;
  readonly resolveModel: () => Promise<Model<Api> | undefined>;
  readonly ids: {
    createBatchId(): string;
    createRecommendationId(): string;
  };
  readonly timers?: {
    setTimeout(callback: () => void, delayMs: number): unknown;
    clearTimeout(handle: unknown): void;
  };
}

export interface DailyDiscoveryRuntime {
  start(): Promise<void>;
  ensure(request: EnsureDailyDiscoveryRequest): Promise<EnsureDailyDiscoveryResult>;
  getHome(request: GetDiscoveryHomeRequest): DiscoveryHomeView;
  searchRecommendations(request: SearchRecommendationsRequest): SearchRecommendationsResult;
  updateRecommendationState(request: UpdateRecommendationStateRequest): RecommendationView;
  getNextScheduledAt(): string | undefined;
  shutdown(): Promise<void>;
}

export function createDailyDiscoveryRuntime(input: CreateDailyDiscoveryRuntimeOptions & {
  readonly models: Pick<Models, 'streamSimple'>;
  readonly createExecutionId: () => string;
  readonly now: () => string;
}): DailyDiscoveryRuntime {
  const activeAgents = new Map<string, Agent>();
  const activePromises = new Set<Promise<void>>();
  const timers = input.timers ?? defaultTimers();
  let accepting = true;
  let started = false;
  let timerHandle: unknown;
  let nextScheduledAt: string | undefined;

  const track = (operation: Promise<void>): void => {
    activePromises.add(operation);
    void operation.finally(() => activePromises.delete(operation));
  };

  const snapshotInputs = async () => {
    const interests = input.repository.listInterests().filter((interest) => interest.status === 'active');
    const settings = input.settings.getDiscoverySettings();
    const descriptors = enabledDescriptors(input.sourceRegistry, settings.enabledSources);
    const model = await input.resolveModel();
    return { interests, settings, descriptors, model };
  };

  const launchAttempt = (attempt: {
    readonly batchId: string;
    readonly executionId: string;
    readonly targetCount: number;
    readonly snapshot?: Awaited<ReturnType<typeof snapshotInputs>>;
  }): void => {
    const operation = (async () => {
      const snapshot = attempt.snapshot ?? await snapshotInputs();
      if (!snapshot.model || snapshot.interests.length === 0 || snapshot.descriptors.length === 0) {
        await handleFailure(
          'agent_execution_failed',
          'Daily discovery retry prerequisites are unavailable.',
          false,
        );
        return;
      }
      const signals = input.repository.listRecommendationSelectionSignals();
      await executeDailyBatch({
        batchId: attempt.batchId,
        executionId: attempt.executionId,
        targetCount: attempt.targetCount,
        model: snapshot.model,
        interests: snapshot.interests.map(copyInterest),
        descriptors: snapshot.descriptors.map(copyDescriptor),
        signals: signals.map(copySignal),
        repository: input.repository,
        sourceRegistry: input.sourceRegistry,
        models: input.models,
        ids: input.ids,
        now: input.now,
        activeAgents,
        onFailure: handleFailure,
      });

      async function handleFailure(code: string, message: string, retryable = true): Promise<void> {
        if (!accepting || !retryable) {
          input.repository.failDailyBatch({
            batchId: attempt.batchId, executionId: attempt.executionId,
            failureCode: code, failureMessage: message, failedAt: input.now(),
          });
          return;
        }
        const nextExecutionId = input.createExecutionId();
        const result = input.repository.failDailyAttempt({
          batchId: attempt.batchId,
          executionId: attempt.executionId,
          nextExecutionId,
          failureCode: code,
          failureMessage: message,
          failedAt: input.now(),
        });
        if (result.status === 'retry_claimed') {
          launchAttempt({
            batchId: result.batch.batchId,
            executionId: result.batch.executionId,
            targetCount: result.batch.targetCount,
          });
        }
      }
    })();
    track(operation);
  };

  const scheduleNext = (): void => {
    if (!accepting || !started) return;
    if (timerHandle !== undefined) timers.clearTimeout(timerHandle);
    const settings = input.settings.getDiscoverySettings();
    nextScheduledAt = nextScheduledTimestamp(input.now(), input.timezone(), settings.dailyGenerationTime);
    const delay = Math.max(0, Date.parse(nextScheduledAt) - Date.parse(input.now()));
    timerHandle = timers.setTimeout(() => {
      timerHandle = undefined;
      if (!accepting) return;
      void runtime.ensure({ trigger: 'schedule', now: input.now() }).finally(scheduleNext);
    }, delay);
    unrefTimer(timerHandle);
  };

  const runtime: DailyDiscoveryRuntime = {
    async start() {
      if (started || !accepting) return;
      started = true;
      for (const batch of input.repository.listRunningDailyBatches()) {
        const nextExecutionId = input.createExecutionId();
        const recovered = input.repository.failDailyAttempt({
          batchId: batch.batchId,
          executionId: batch.executionId,
          nextExecutionId,
          failureCode: 'attempt_interrupted',
          failureMessage: 'The previous daily discovery attempt was interrupted by application shutdown.',
          failedAt: input.now(),
        });
        if (recovered.status === 'retry_claimed') {
          launchAttempt({
            batchId: recovered.batch.batchId,
            executionId: recovered.batch.executionId,
            targetCount: recovered.batch.targetCount,
          });
        }
      }
      const settings = input.settings.getDiscoverySettings();
      const scheduledToday = scheduledTimestamp(
        localDateAt(input.now(), input.timezone()),
        settings.dailyGenerationTime,
        input.timezone(),
      );
      if (Date.parse(input.now()) >= Date.parse(scheduledToday)) {
        await runtime.ensure({ trigger: 'startup_catchup', now: input.now() });
      }
      scheduleNext();
    },

    async ensure(request) {
      const parsed = EnsureDailyDiscoveryRequestSchema.parse(request);
      const timezone = input.timezone();
      const localDate = localDateAt(parsed.now, timezone);
      const existing = input.repository.getDailyBatch(localDate);
      if (existing?.status === 'published') {
        return {
          status: 'already_published', localDate, batchId: existing.batchId,
          resultCount: existing.resultCount, publishedAt: existing.publishedAt!,
        };
      }
      if (existing?.status === 'running') {
        return { status: 'in_progress', localDate, batchId: existing.batchId, executionId: existing.executionId };
      }
      if (existing?.status === 'failed' && parsed.trigger !== 'manual' && parsed.trigger !== 'retry') {
        return {
          status: 'failed', localDate,
          failure: {
            code: existing.failureCode ?? 'agent_execution_failed',
            message: existing.failureMessage ?? 'Daily discovery failed.',
            retryable: true,
          },
        };
      }
      if (!accepting) {
        return {
          status: 'failed', localDate,
          failure: { code: 'shutting_down', message: 'Daily discovery is shutting down.', retryable: false },
        };
      }

      const snapshot = await snapshotInputs();
      if (snapshot.interests.length === 0) return { status: 'no_active_interests', localDate };
      if (snapshot.descriptors.length === 0) return { status: 'no_available_sources', localDate };
      if (!snapshot.model) return { status: 'model_unavailable', localDate };

      const batchId = existing?.batchId ?? input.ids.createBatchId();
      const executionId = input.createExecutionId();
      const targetCount = Math.max(1, Math.min(100, Math.floor(snapshot.settings.dailyTargetCount)));
      const retried = existing?.status === 'failed'
        ? input.repository.retryFailedDailyBatch({
            batchId, executionId, targetCount, startedAt: parsed.now,
          })
        : undefined;
      const claimed = retried
        ? { status: 'claimed' as const, batch: retried }
        : input.repository.claimDailyBatch({
            batchId, localDate, timezone, executionId, targetCount, now: parsed.now,
          });
      if (claimed.status === 'already_published') {
        return {
          status: 'already_published', localDate, batchId: claimed.batch.batchId,
          resultCount: claimed.batch.resultCount, publishedAt: claimed.batch.publishedAt!,
        };
      }
      if (claimed.status === 'in_progress') {
        return {
          status: 'in_progress', localDate, batchId: claimed.batch.batchId,
          executionId: claimed.batch.executionId,
        };
      }
      if (claimed.status !== 'claimed') {
        return {
          status: 'failed', localDate,
          failure: {
            code: claimed.batch.failureCode ?? 'database_failed',
            message: claimed.batch.failureMessage ?? 'Daily discovery batch could not be claimed.',
            retryable: true,
          },
        };
      }

      launchAttempt({ batchId, executionId, targetCount, snapshot });
      return { status: 'started', localDate, batchId, executionId };
    },

    getHome(request) {
      return input.repository.readHome({
        ...request,
        localDate: localDateAt(input.now(), input.timezone()),
        ...(nextScheduledAt ? { nextScheduledAt } : {}),
      });
    },

    searchRecommendations: (request) => input.repository.searchRecommendations(request),

    updateRecommendationState: (request) => input.repository.updateRecommendationState({
      ...request,
      now: input.now(),
    }),

    getNextScheduledAt: () => nextScheduledAt,

    async shutdown() {
      accepting = false;
      if (timerHandle !== undefined) timers.clearTimeout(timerHandle);
      timerHandle = undefined;
      nextScheduledAt = undefined;
      for (const agent of activeAgents.values()) agent.abort();
      while (activePromises.size > 0) await Promise.allSettled([...activePromises]);
    },
  };
  return runtime;
}

async function executeDailyBatch(input: {
  readonly batchId: string;
  readonly executionId: string;
  readonly targetCount: number;
  readonly model: Model<Api>;
  readonly interests: readonly Interest[];
  readonly descriptors: readonly SourceDescriptor[];
  readonly signals: readonly RecommendationSelectionSignal[];
  readonly repository: DiscoveryRepository;
  readonly sourceRegistry: SourceRegistry;
  readonly models: Pick<Models, 'streamSimple'>;
  readonly ids: Pick<CreateDailyDiscoveryRuntimeOptions['ids'], 'createRecommendationId'>;
  readonly now: () => string;
  readonly activeAgents: Map<string, Agent>;
  readonly onFailure: (code: string, message: string, retryable?: boolean) => Promise<void>;
}): Promise<void> {
  const candidates = createCandidateRegistry();
  const historicalIdentities = new Set(input.signals.map((signal) => signal.contentIdentity));
  let selected: readonly { candidateId: string; recommendationReason: string }[] | undefined;
  let searchCount = 0;
  let readCount = 0;
  let successfulSearches = 0;
  let failedSearches = 0;
  let rawCandidates = 0;
  let invalidSelection = false;
  const sourceFailures: Array<{ readonly sourceId: string; readonly failure: SourceFailure }> = [];

  const tools: readonly AgentTool[] = [
    {
      name: 'search_content',
      description: 'Search one enabled content source with one explicit query.',
      parameters: Type.Object({
        sourceId: Type.String(), query: Type.String(),
        mode: Type.Union([Type.Literal('relevance'), Type.Literal('recent')]),
        limit: Type.Integer({ minimum: 1, maximum: 20 }),
      }),
      executionMode: 'sequential',
      execute: async ({ arguments: value, signal }) => {
        if (selected) return toolError('selection_frozen', 'Recommendations have already been selected.');
        if (searchCount >= MAX_SEARCH_CALLS) return toolError('search_budget_exhausted', 'The 12-search budget is exhausted.');
        if (candidates.list().length >= MAX_CANDIDATES) return toolError('candidate_budget_exhausted', 'The 200-candidate budget is exhausted.');
        const parsed = parseSearchArguments(value);
        if (!parsed.ok) return toolError('invalid_search_request', parsed.message);
        let source;
        try {
          source = input.sourceRegistry.resolve(parsed.sourceId, parsed.mode);
        } catch (error) {
          return toolError('invalid_search_request', error instanceof Error ? error.message : 'Invalid source.');
        }
        if (!input.descriptors.some((descriptor) => descriptor.id === parsed.sourceId)) {
          return toolError('source_not_enabled', `Source ${parsed.sourceId} is not enabled for this execution.`);
        }
        searchCount += 1;
        const result = await source.search({ ...parsed, signal });
        if (result.status === 'failed') {
          failedSearches += 1;
          sourceFailures.push({ sourceId: parsed.sourceId, failure: result.failure });
          return toolError(result.failure.code, result.failure.message, { failure: result.failure });
        }
        successfulSearches += 1;
        rawCandidates += result.items.length;
        const available = Math.max(0, MAX_CANDIDATES - candidates.list().length);
        const admitted = result.items
          .filter((content) => admissible(content, source.descriptor.id, historicalIdentities))
          .slice(0, available);
        const inserted = candidates.add(admitted);
        return toolSuccess({
          status: 'success',
          candidates: inserted.map(candidateSummary),
          resultCount: result.items.length,
          admittedCount: inserted.length,
          candidateCount: candidates.list().length,
        });
      },
    },
    {
      name: 'read_candidate',
      description: 'Read more public content for one admitted candidate.',
      parameters: Type.Object({ candidateId: Type.String() }),
      executionMode: 'sequential',
      execute: async ({ arguments: value, signal }) => {
        if (selected) return toolError('selection_frozen', 'Recommendations have already been selected.');
        if (readCount >= MAX_READ_CALLS) return toolError('read_budget_exhausted', 'The 40-read budget is exhausted.');
        const candidateId = recordString(value, 'candidateId');
        const candidate = candidateId ? candidates.get(candidateId) : undefined;
        if (!candidate) return toolError('candidate_not_found', 'Candidate was not found in this execution.');
        const source = input.sourceRegistry.get(candidate.sourceId);
        if (!source?.read) return toolError('read_unavailable', 'This source does not support candidate reading.');
        readCount += 1;
        const result = await source.read({
          sourceContentId: candidate.sourceContentId,
          url: candidate.canonicalUrl,
          signal,
        });
        if (result.status === 'failed') {
          return toolError(result.failure.code, result.failure.message, { failure: result.failure });
        }
        try {
          const updated = candidates.attachDetail(candidate.candidateId, result.detail);
          return toolSuccess({ status: 'success', candidate: candidateSummary(updated), detail: result.detail });
        } catch (error) {
          return toolError('invalid_candidate_detail', error instanceof Error ? error.message : 'Candidate detail was invalid.');
        }
      },
    },
    {
      name: 'select_recommendations',
      description: 'Freeze the ordered Recommendation selection for this execution.',
      parameters: Type.Object({
        items: Type.Array(Type.Object({
          candidateId: Type.String(),
          recommendationReason: Type.String(),
        })),
      }),
      executionMode: 'sequential',
      execute: async ({ arguments: value }) => {
        if (selected) return toolError('selection_frozen', 'The first valid selection is already frozen.');
        const parsed = parseSelection(value, input.targetCount, candidates);
        if (!parsed.ok) {
          invalidSelection = true;
          return toolError('selection_invalid', parsed.message);
        }
        selected = parsed.items;
        return toolSuccess({ status: 'selected', count: selected.length });
      },
    },
  ];

  const agent = new Agent({
    initialState: {
      configuration: {
        systemPrompt: dailySystemPrompt(input),
        model: input.model,
        thinkingLevel: input.model.reasoning ? 'high' : 'minimal',
        tools,
      },
      messages: [],
    },
    stream: (model, context, options) => input.models.streamSimple(model, context, options),
    policy: {
      maxModelCalls: 24,
      maxModelCallAttempts: 2,
      maxToolRounds: 20,
      maxToolCalls: 128,
      maxToolCallsPerModelCall: 64,
      maxConcurrentToolCalls: 1,
      modelCallTimeoutMs: 120_000,
      toolCallTimeoutMs: 30_000,
      modelRetryDelayMs: 250,
      maxContextOverflowRecoveries: 1,
    },
  });
  input.activeAgents.set(input.executionId, agent);

  try {
    const result = await agent.prompt({
      role: 'user',
      content: '为今天生成个性化内容推荐。使用工具完成搜索和选择。',
      timestamp: Date.parse(input.now()),
    }, { executionId: input.executionId });
    if (result.status !== 'completed') {
      await input.onFailure(
        'agent_execution_failed',
        result.status === 'cancelled'
          ? 'Daily discovery Agent execution was cancelled.'
          : result.error.message,
        result.status !== 'cancelled',
      );
      return;
    }
    if (!selected) {
      const code = invalidSelection ? 'selection_invalid'
        : candidates.list().length > 0 ? 'selection_missing'
          : successfulSearches === 0 && failedSearches > 0 ? 'source_search_failed'
            : rawCandidates > 0 ? 'all_candidates_rejected'
              : successfulSearches > 0 ? 'no_candidates'
                : 'selection_missing';
      const message = code === 'source_search_failed'
        ? sourceSearchFailureMessage(sourceFailures)
        : failureMessage(code);
      const retryable = code === 'source_search_failed'
        ? sourceFailures.some(({ failure }) => isImmediatelyRetryableSourceFailure(failure))
        : true;
      await input.onFailure(code, message, retryable);
      return;
    }
    const publishedAt = input.now();
    const recommendations = selected.map((selection, position) => {
      const candidate = candidates.get(selection.candidateId)!;
      return recommendationFromCandidate({
        candidate, batchId: input.batchId,
        recommendationId: input.ids.createRecommendationId(),
        recommendationReason: selection.recommendationReason,
        position, publishedAt,
      });
    });
    const published = input.repository.publishDailyBatch({
      batchId: input.batchId,
      executionId: input.executionId,
      publishedAt,
      recommendations,
    });
    if (published.status !== 'published') {
      await input.onFailure(
        'publish_conflict',
        `Daily discovery publication failed: ${published.reason}.`,
        false,
      );
    }
  } catch (error) {
    await input.onFailure('agent_execution_failed', error instanceof Error ? error.message : 'Daily discovery failed.');
  } finally {
    input.activeAgents.delete(input.executionId);
    candidates.dispose();
  }
}

function dailySystemPrompt(input: {
  readonly interests: readonly Interest[];
  readonly descriptors: readonly SourceDescriptor[];
  readonly signals: readonly RecommendationSelectionSignal[];
  readonly targetCount: number;
}): string {
  return [
    '你是 Megumi 的每日个性化信息发现 Agent。',
    '你必须主动制定查询、必要时换词或换来源，并只通过 select_recommendations 确定最终结果。',
    '不要按关注分配固定配额，不要用无关热门内容凑数；结果可以少于目标数量。',
    '最终文本不构成推荐，第一次有效选择会被冻结。',
    JSON.stringify({
      targetCount: input.targetCount,
      interests: input.interests.map((interest) => ({
        interestId: interest.interestId,
        description: interest.description,
      })),
      sources: input.descriptors,
      priorFeedback: input.signals.flatMap((signal) => signal.reaction ? [{
        sourceName: signal.sourceName, title: signal.title, reaction: signal.reaction,
      }] : []),
      exposedContentIdentities: input.signals.map((signal) => signal.contentIdentity),
    }),
  ].join('\n');
}

function enabledDescriptors(registry: SourceRegistry, enabled: readonly DiscoverySourceId[]): SourceDescriptor[] {
  const enabledIds = new Set(enabled);
  return registry.listDescriptors().filter((descriptor) => enabledIds.has(descriptor.id));
}

function admissible(content: SourceContent, expectedSourceId: string, historical: ReadonlySet<string>): boolean {
  if (content.sourceId !== expectedSourceId) return false;
  if (historical.has(discoveryContentIdentity(content))) return false;
  // Strongly time-sensitive content needs a reliable publication time in v1.
  if (content.contentType === 'news' && !content.publishedAt) return false;
  return true;
}

function parseSearchArguments(value: unknown):
  | { readonly ok: true; readonly sourceId: string; readonly query: string; readonly mode: SourceSearchMode; readonly limit: number }
  | { readonly ok: false; readonly message: string } {
  const sourceId = recordString(value, 'sourceId');
  const query = recordString(value, 'query');
  const mode = recordString(value, 'mode');
  const limit = recordNumber(value, 'limit');
  if (!sourceId || !query || query.length > 200 || (mode !== 'relevance' && mode !== 'recent')
    || !Number.isInteger(limit) || limit! < 1 || limit! > 20) {
    return { ok: false, message: 'Search requires an enabled source, a 1..200 character query, a supported mode and limit 1..20.' };
  }
  return { ok: true, sourceId, query, mode, limit: limit! };
}

function parseSelection(
  value: unknown,
  targetCount: number,
  candidates: ReturnType<typeof createCandidateRegistry>,
): { readonly ok: true; readonly items: readonly { candidateId: string; recommendationReason: string }[] }
  | { readonly ok: false; readonly message: string } {
  const items = isRecord(value) && Array.isArray(value.items) ? value.items : undefined;
  if (!items || items.length === 0 || items.length > targetCount) {
    return { ok: false, message: `Selection must contain 1..${targetCount} candidates.` };
  }
  const parsed: Array<{ candidateId: string; recommendationReason: string }> = [];
  const seen = new Set<string>();
  for (const item of items) {
    const candidateId = recordString(item, 'candidateId');
    const recommendationReason = recordString(item, 'recommendationReason');
    if (!candidateId || !recommendationReason || recommendationReason.length > 1_000
      || seen.has(candidateId) || !candidates.get(candidateId)) {
      return { ok: false, message: 'Selection contains an unknown, duplicate or invalid candidate.' };
    }
    seen.add(candidateId);
    parsed.push({ candidateId, recommendationReason });
  }
  return { ok: true, items: parsed };
}

function recommendationFromCandidate(input: {
  readonly candidate: DiscoveryCandidate;
  readonly batchId: string;
  readonly recommendationId: string;
  readonly recommendationReason: string;
  readonly position: number;
  readonly publishedAt: string;
}): Recommendation {
  const candidate = input.candidate;
  return {
    recommendationId: input.recommendationId,
    batchId: input.batchId,
    contentIdentity: discoveryContentIdentity(candidate),
    position: input.position,
    sourceId: candidate.sourceId,
    sourceName: candidate.sourceName,
    canonicalUrl: candidate.canonicalUrl,
    contentType: candidate.contentType,
    ...(candidate.sourceContentId ? { sourceContentId: candidate.sourceContentId } : {}),
    title: candidate.title,
    ...(candidate.author ? { author: candidate.author } : {}),
    ...(candidate.publishedAt ? { contentPublishedAt: candidate.publishedAt } : {}),
    ...(candidate.description ? { description: candidate.description } : {}),
    ...(candidate.coverUrl ? { coverUrl: candidate.coverUrl } : {}),
    recommendationReason: input.recommendationReason,
    publishedAt: input.publishedAt,
  };
}

function candidateSummary(candidate: DiscoveryCandidate) {
  return {
    candidateId: candidate.candidateId,
    sourceName: candidate.sourceName,
    canonicalUrl: candidate.canonicalUrl,
    contentType: candidate.contentType,
    title: candidate.title,
    ...(candidate.author ? { author: candidate.author } : {}),
    ...(candidate.publishedAt ? { publishedAt: candidate.publishedAt } : {}),
    ...(candidate.description ? { description: candidate.description } : {}),
  };
}

function toolSuccess(value: unknown) {
  return {
    status: 'completed' as const,
    result: { content: [{ type: 'text' as const, text: JSON.stringify(value) }], isError: false },
  };
}

function toolError(code: string, message: string, extra: Record<string, unknown> = {}) {
  return {
    status: 'completed' as const,
    result: {
      content: [{ type: 'text' as const, text: JSON.stringify({ status: 'failed', code, message, ...extra }) }],
      isError: true,
    },
  };
}

function failureMessage(code: string): string {
  const messages: Record<string, string> = {
    selection_missing: 'Daily discovery ended without selecting recommendations.',
    selection_invalid: 'Daily discovery ended after an invalid selection.',
    source_search_failed: 'All attempted content-source searches failed.',
    no_candidates: 'Content searches succeeded but returned no candidates.',
    all_candidates_rejected: 'All discovered candidates were deterministically rejected.',
  };
  return messages[code] ?? 'Daily discovery failed.';
}

function sourceSearchFailureMessage(
  failures: readonly { readonly sourceId: string; readonly failure: SourceFailure }[],
): string {
  const seen = new Set<string>();
  const details = failures.flatMap(({ sourceId, failure }) => {
    const key = `${sourceId}\u0000${failure.code}\u0000${failure.message}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [`${sourceId} (${failure.code}): ${failure.message}`];
  });
  return details.length > 0
    ? `Content source searches failed: ${details.join('; ')}`
    : failureMessage('source_search_failed');
}

function isImmediatelyRetryableSourceFailure(failure: SourceFailure): boolean {
  return failure.retryable && (failure.code === 'network_error' || failure.code === 'timeout');
}

function localDateAt(timestamp: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function nextScheduledTimestamp(now: string, timezone: string, generationTime: string): string {
  const today = localDateAt(now, timezone);
  const todayScheduled = scheduledTimestamp(today, generationTime, timezone);
  if (Date.parse(todayScheduled) > Date.parse(now)) return todayScheduled;
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return scheduledTimestamp(date.toISOString().slice(0, 10), generationTime, timezone);
}

function scheduledTimestamp(localDate: string, generationTime: string, timezone: string): string {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/u.test(generationTime)) {
    throw new Error('Discovery dailyGenerationTime must use HH:mm.');
  }
  const [year, month, day] = localDate.split('-').map(Number);
  const [hour, minute] = generationTime.split(':').map(Number);
  const desiredAsUtc = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  let instant = desiredAsUtc;
  for (let index = 0; index < 3; index += 1) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(instant));
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const representedAsUtc = Date.UTC(
      Number(value.year), Number(value.month) - 1, Number(value.day),
      Number(value.hour), Number(value.minute), Number(value.second),
    );
    instant += desiredAsUtc - representedAsUtc;
  }
  return new Date(instant).toISOString();
}

function defaultTimers() {
  return {
    setTimeout(callback: () => void, delayMs: number): unknown {
      return globalThis.setTimeout(callback, Math.min(delayMs, 2_147_483_647));
    },
    clearTimeout(handle: unknown): void {
      globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
    },
  };
}

function unrefTimer(handle: unknown): void {
  if (handle && typeof handle === 'object' && 'unref' in handle
    && typeof (handle as { unref?: unknown }).unref === 'function') {
    (handle as { unref(): void }).unref();
  }
}

function copyInterest(interest: Interest): Interest {
  return { ...interest };
}

function copyDescriptor(descriptor: SourceDescriptor): SourceDescriptor {
  return { ...descriptor, supportedModes: [...descriptor.supportedModes] };
}

function copySignal(signal: RecommendationSelectionSignal): RecommendationSelectionSignal {
  return { ...signal };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordString(value: unknown, key: string): string | undefined {
  if (!isRecord(value) || typeof value[key] !== 'string') return undefined;
  const result = value[key].trim();
  return result || undefined;
}

function recordNumber(value: unknown, key: string): number | undefined {
  return isRecord(value) && typeof value[key] === 'number' ? value[key] : undefined;
}
