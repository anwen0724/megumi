/* Owns daily preflight, one background Agent Execution, bounded discovery Tools and publication. */
import { Agent, type AgentContextProvider } from '@megumi/agent-core';
import { type Api, type Model, type Models } from '@megumi/ai';
import type { Tools } from '@megumi/tools';
import { discoveryContentIdentity, type DiscoveryCandidate } from './candidate-registry';
import { createDailyDiscoveryTools } from './daily-discovery-tools';
import { createUnprotectedAgentTool } from '@megumi/execution';
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
  SourceDescriptor,
  SourceFailure,
} from '../sources/discovery-source';
import type { SourceRegistry } from '../sources/source-registry';

export interface CreateDailyDiscoveryRuntimeOptions {
  readonly repository: DiscoveryRepository;
  readonly sourceRegistry: SourceRegistry;
  readonly tools: Pick<Tools, 'bindExecution'>;
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
  let identitiesMigrated = false;

  const ensureIdentityMigration = (): void => {
    if (identitiesMigrated) return;
    input.repository.migrateRecommendationIdentities();
    identitiesMigrated = true;
  };

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
        tools: input.tools,
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
      ensureIdentityMigration();
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

      try {
        ensureIdentityMigration();
      } catch {
        return {
          status: 'failed', localDate,
          failure: {
            code: 'content_identity_migration_failed',
            message: 'Discovery content identities could not be migrated.',
            retryable: false,
          },
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
  readonly tools: Pick<Tools, 'bindExecution'>;
  readonly models: Pick<Models, 'streamSimple'>;
  readonly ids: Pick<CreateDailyDiscoveryRuntimeOptions['ids'], 'createRecommendationId'>;
  readonly now: () => string;
  readonly activeAgents: Map<string, Agent>;
  readonly onFailure: (code: string, message: string, retryable?: boolean) => Promise<void>;
}): Promise<void> {
  const dailyTools = createDailyDiscoveryTools(input);
  const bound = input.tools.bindExecution({
    executionId: input.executionId,
    subject: { kind: 'background' },
    includeBuiltIns: false,
    toolSets: [dailyTools.toolSet],
  });
  if (bound.status === 'failed') {
    dailyTools.dispose();
    await input.onFailure('tool_system_failed', bound.failure.message);
    return;
  }
  const toolExecution = bound.binding;
  let activeModelCall: import('@megumi/tools').ModelCallToolBinding | undefined;
  let modelCallSequence = 0;
  const contextProvider: AgentContextProvider = {
    async prepare({ context, signal }) {
      activeModelCall?.close();
      if (signal.aborted) return { status: 'cancelled' };
      const prepared = toolExecution.prepareModelCall({
        modelCallId: `${input.executionId}:model-call:${++modelCallSequence}`,
      });
      if (prepared.status === 'failed') {
        return {
          status: 'failed',
          error: {
            code: 'context_failed',
            message: prepared.failure.message,
            retryable: true,
            cause: { owner: 'tools', code: prepared.failure.code },
          },
        };
      }
      activeModelCall = prepared.binding;
      return {
        status: 'ready',
        context: {
          ...context,
          systemPrompt: dailySystemPrompt(input),
          tools: prepared.binding.definitions.map((definition) => (
            createUnprotectedAgentTool(definition, prepared.binding)
          )),
        },
      };
    },
  };

  const agent = new Agent({
    initialState: {
      configuration: {
        systemPrompt: dailySystemPrompt(input),
        model: input.model,
        thinkingLevel: input.model.reasoning ? 'high' : 'minimal',
        tools: [],
      },
      messages: [],
    },
    stream: (model, context, options) => input.models.streamSimple(model, context, options),
    context: contextProvider,
    policy: {
      maxModelCalls: 24,
      maxModelCallAttempts: 2,
      maxToolRounds: 20,
      maxToolCalls: 128,
      maxToolCallsPerModelCall: 64,
      maxConcurrentToolCalls: 1,
      modelCallTimeoutMs: 120_000,
      toolCallTimeoutMs: 90_000,
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
    const toolState = dailyTools.snapshot();
    if (!toolState.selected) {
      const code = toolState.invalidSelection ? 'selection_invalid'
        : toolState.candidates.list().length > 0 ? 'selection_missing'
          : toolState.successfulSearches === 0 && toolState.failedSearches > 0 ? 'source_search_failed'
            : toolState.rawCandidates > 0 ? 'all_candidates_rejected'
              : toolState.successfulSearches > 0 ? 'no_candidates'
                : 'selection_missing';
      const message = code === 'source_search_failed'
        ? sourceSearchFailureMessage(toolState.sourceFailures)
        : failureMessage(code);
      const retryable = code === 'source_search_failed'
        ? toolState.sourceFailures.some(({ failure }) => isImmediatelyRetryableSourceFailure(failure))
        : true;
      await input.onFailure(code, message, retryable);
      return;
    }
    const publishedAt = input.now();
    const recommendations = toolState.selected.map((selection, position) => {
      const candidate = toolState.candidates.get(selection.candidateId)!;
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
    activeModelCall?.close();
    toolExecution.close();
    dailyTools.dispose();
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
  return registry.listSources()
    .filter(({ descriptor, availability }) => (
      enabledIds.has(descriptor.id)
      && (availability.state === 'ready' || availability.state === 'unknown')
    ))
    .map(({ descriptor }) => descriptor);
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
