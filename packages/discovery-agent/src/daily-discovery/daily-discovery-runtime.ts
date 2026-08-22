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
import type {
  DiscoverySourceId,
  SourceContent,
  SourceDescriptor,
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
}

export interface DailyDiscoveryRuntime {
  ensure(request: EnsureDailyDiscoveryRequest): Promise<EnsureDailyDiscoveryResult>;
  shutdown(): Promise<void>;
}

export function createDailyDiscoveryRuntime(input: CreateDailyDiscoveryRuntimeOptions & {
  readonly models: Pick<Models, 'streamSimple'>;
  readonly createExecutionId: () => string;
  readonly now: () => string;
}): DailyDiscoveryRuntime {
  const activeAgents = new Map<string, Agent>();
  const activePromises = new Set<Promise<void>>();
  let accepting = true;

  return {
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
      if (existing?.status === 'failed') {
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

      const interests = input.repository.listInterests().filter((interest) => interest.status === 'active');
      if (interests.length === 0) return { status: 'no_active_interests', localDate };
      const settings = input.settings.getDiscoverySettings();
      const descriptors = enabledDescriptors(input.sourceRegistry, settings.enabledSources);
      if (descriptors.length === 0) return { status: 'no_available_sources', localDate };
      const model = await input.resolveModel();
      if (!model) return { status: 'model_unavailable', localDate };

      const batchId = input.ids.createBatchId();
      const executionId = input.createExecutionId();
      const targetCount = Math.max(1, Math.min(100, Math.floor(settings.dailyTargetCount)));
      const claimed = input.repository.claimDailyBatch({
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

      // Every fact below is snapshotted before the asynchronous execution starts.
      const signals = input.repository.listRecommendationSelectionSignals();
      const execution = executeDailyBatch({
        batchId, executionId, targetCount, model,
        interests: interests.map(copyInterest),
        descriptors: descriptors.map(copyDescriptor),
        signals: signals.map(copySignal),
        repository: input.repository,
        sourceRegistry: input.sourceRegistry,
        models: input.models,
        ids: input.ids,
        now: input.now,
        activeAgents,
      }).catch(() => undefined).finally(() => activePromises.delete(execution));
      activePromises.add(execution);
      return { status: 'started', localDate, batchId, executionId };
    },

    async shutdown() {
      accepting = false;
      for (const agent of activeAgents.values()) agent.abort();
      await Promise.allSettled([...activePromises]);
    },
  };
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
      failBatch(input, 'agent_execution_failed', result.status === 'cancelled'
        ? 'Daily discovery Agent execution was cancelled.'
        : result.error.message);
      return;
    }
    if (!selected) {
      const code = invalidSelection ? 'selection_invalid'
        : candidates.list().length > 0 ? 'selection_missing'
          : successfulSearches === 0 && failedSearches > 0 ? 'source_search_failed'
            : rawCandidates > 0 ? 'all_candidates_rejected'
              : successfulSearches > 0 ? 'no_candidates'
                : 'selection_missing';
      failBatch(input, code, failureMessage(code));
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
      failBatch(input, 'publish_conflict', `Daily discovery publication failed: ${published.reason}.`);
    }
  } catch (error) {
    failBatch(input, 'agent_execution_failed', error instanceof Error ? error.message : 'Daily discovery failed.');
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

function failBatch(
  input: { readonly repository: DiscoveryRepository; readonly batchId: string; readonly executionId: string; readonly now: () => string },
  code: string,
  message: string,
): void {
  input.repository.failDailyBatch({
    batchId: input.batchId,
    executionId: input.executionId,
    failureCode: code,
    failureMessage: message,
    failedAt: input.now(),
  });
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

function localDateAt(timestamp: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
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
