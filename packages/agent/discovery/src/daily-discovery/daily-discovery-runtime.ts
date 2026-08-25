/* Owns daily preflight, Batch/Attempt facts, result publication, retries, and scheduling. */
import { type Api, type Model } from '@megumi/ai';
import type { DailyDiscoveryContextMaterial } from '@megumi/context';
import type {
  DailyDiscoveryExecutionInput,
  ExecutionOutcome,
  StartDailyDiscoveryExecutionResult,
} from '@megumi/execution';
import { discoveryContentIdentity, type DiscoveryCandidate } from './candidate-registry';
import type { DailyDiscoveryAttempts, SourceAttemptBudget } from './daily-discovery-attempt';
import {
  EnsureDailyDiscoveryRequestSchema,
  type EnsureDailyDiscoveryRequest,
  type EnsureDailyDiscoveryResult,
} from './daily-discovery';
import {
  createDailyDiscoveryScheduler,
  localDateAt,
  type DailyDiscoveryScheduler,
} from './daily-discovery-scheduler';
import type { Interest } from '../interests/interest';
import type { DailyBatchRepository } from '../persistence/daily-batch-repository';
import type { InterestRepository } from '../persistence/interest-repository';
import type {
  RecommendationSelectionSignal,
  RecommendationRepositoryOperations,
} from '../persistence/recommendation-repository';
import type { RecommendationIdentityMigrationResult } from '../persistence/recommendation-identity-migration';
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
  readonly repository: DailyDiscoveryRepository;
  readonly sourceRegistry: SourceRegistry;
  readonly attempts: DailyDiscoveryAttempts;
  readonly startExecution: <TRejected>(
    request: DailyDiscoveryExecutionInput<TRejected>,
  ) => Promise<StartDailyDiscoveryExecutionResult<TRejected>>;
  readonly settings: {
    getDiscoverySettings(): {
      readonly dailyGenerationTime: string;
      readonly dailyTargetCount: number;
      readonly enabledSources: readonly DiscoverySourceId[];
      readonly sourceBudgets?: Readonly<Record<string, SourceAttemptBudget>>;
    };
  };
  readonly timezone: () => string;
  readonly resolveModel: () => Promise<Model<Api> | undefined>;
  readonly ids: {
    createBatchId(): string;
    createRecommendationId(): string;
  };
  readonly onBackgroundError: (
    error: unknown,
    context: DailyDiscoveryBackgroundErrorContext,
  ) => void;
  readonly timers?: {
    setTimeout(callback: () => void, delayMs: number): unknown;
    clearTimeout(handle: unknown): void;
  };
}

type DailyDiscoveryRepository = DailyBatchRepository
  & Pick<InterestRepository, 'listInterests'>
  & Pick<
    RecommendationRepositoryOperations,
    | 'listRecommendationSelectionSignals'
    | 'readHome'
    | 'searchRecommendations'
    | 'updateRecommendationState'
  >
  & {
    migrateRecommendationIdentities(): RecommendationIdentityMigrationResult;
  };

export interface DailyDiscoveryBackgroundErrorContext {
  readonly operation: 'attempt_settlement' | 'startup_recovery' | 'scheduled_ensure';
  readonly batchId?: string;
  readonly executionId?: string;
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
  readonly now: () => string;
}): DailyDiscoveryRuntime {
  const activePromises = new Set<Promise<void>>();
  let accepting = true;
  let started = false;
  let identitiesMigrated = false;
  let scheduler: DailyDiscoveryScheduler;

  const ensureIdentityMigration = (): void => {
    if (identitiesMigrated) return;
    input.repository.migrateRecommendationIdentities();
    identitiesMigrated = true;
  };

  const reportBackgroundError = (
    error: unknown,
    context: DailyDiscoveryBackgroundErrorContext,
  ): void => {
    try {
      input.onBackgroundError(error, context);
    } catch {
      // The observer is the terminal boundary and must not create another rejection.
    }
  };

  const track = (
    operation: Promise<void>,
    context: DailyDiscoveryBackgroundErrorContext,
  ): void => {
    let tracked!: Promise<void>;
    tracked = (async () => {
      try {
        await operation;
      } catch (error) {
        reportBackgroundError(error, context);
      } finally {
        activePromises.delete(tracked);
      }
    })();
    activePromises.add(tracked);
  };

  const snapshotInputs = async () => {
    const interests = input.repository.listInterests().filter((interest) => interest.status === 'active');
    const settings = input.settings.getDiscoverySettings();
    const descriptors = enabledDescriptors(input.sourceRegistry, settings.enabledSources);
    const model = await input.resolveModel();
    return { interests, settings, descriptors, model };
  };

  const startAttempt = async (request: {
    readonly batchId: string;
    readonly localDate: string;
    readonly timezone: string;
    readonly targetCount: number;
    readonly requestId: string;
    readonly snapshot: Awaited<ReturnType<typeof snapshotInputs>>;
    readonly claim: (executionId: string) => EnsureDailyDiscoveryResult | undefined;
  }): Promise<EnsureDailyDiscoveryResult> => {
    const { snapshot } = request;
    if (!snapshot.model || snapshot.interests.length === 0 || snapshot.descriptors.length === 0) {
      return failedResult(request.localDate, 'agent_execution_failed', 'Daily discovery prerequisites are unavailable.', false);
    }
    const signals = input.repository.listRecommendationSelectionSignals().map(copySignal);
    const material = discoveryMaterial({
      targetCount: request.targetCount,
      interests: snapshot.interests,
      descriptors: snapshot.descriptors,
      signals,
    });
    const started = await input.startExecution<EnsureDailyDiscoveryResult>({
      kind: 'daily_discovery',
      requestId: request.requestId,
      batchId: request.batchId,
      localDate: request.localDate,
      material,
      model: snapshot.model,
      async accept({ executionId }) {
        const rejected = request.claim(executionId);
        if (rejected) return { status: 'rejected', reason: rejected };
        try {
          input.attempts.start({
            executionId,
            targetCount: request.targetCount,
            descriptors: snapshot.descriptors.map(copyDescriptor),
            signals,
            sourceRegistry: input.sourceRegistry,
            sourceBudgets: snapshot.settings.sourceBudgets ?? {},
          });
          return { status: 'accepted' };
        } catch (error) {
          input.repository.failDailyBatch({
            batchId: request.batchId,
            executionId,
            failureCode: 'attempt_start_failed',
            failureMessage: error instanceof Error ? error.message : 'Daily discovery attempt could not start.',
            failedAt: input.now(),
          });
          return {
            status: 'rejected',
            reason: failedResult(request.localDate, 'attempt_start_failed', 'Daily discovery attempt could not start.', false),
          };
        }
      },
      onSettled({ executionId, outcome }) {
        const operation = settleAttempt({
          batchId: request.batchId,
          localDate: request.localDate,
          targetCount: request.targetCount,
          executionId,
          outcome,
        });
        track(operation, {
          operation: 'attempt_settlement',
          batchId: request.batchId,
          executionId,
        });
        return operation;
      },
    });
    if (started.status === 'rejected') return started.reason;
    if (started.status === 'failed') {
      return failedResult(request.localDate, 'agent_execution_failed', started.failure.message, started.failure.retryable);
    }
    return {
      status: 'started',
      localDate: request.localDate,
      batchId: request.batchId,
      executionId: started.execution.executionId,
    };
  };

  const settleAttempt = async (request: {
    readonly batchId: string;
    readonly localDate: string;
    readonly targetCount: number;
    readonly executionId: string;
    readonly outcome: ExecutionOutcome;
  }): Promise<void> => {
    try {
      if (request.outcome.status !== 'completed') {
        const message = request.outcome.status === 'cancelled'
          ? 'Daily discovery Agent execution was cancelled.'
          : request.outcome.failure.message;
        await handleAttemptFailure(request, 'agent_execution_failed', message, request.outcome.status === 'failed' && request.outcome.failure.retryable);
        return;
      }
      const state = input.attempts.snapshot(request.executionId);
      if (!state) {
        await handleAttemptFailure(request, 'attempt_not_found', 'Daily discovery attempt state was lost.', false);
        return;
      }
      if (!state.selected) {
        const code = state.invalidSelection ? 'selection_invalid'
          : state.candidates.list().length > 0 ? 'selection_missing'
            : state.successfulSearches === 0 && state.failedSearches > 0 ? 'source_search_failed'
              : state.rawCandidates > 0 ? 'all_candidates_rejected'
                : state.successfulSearches > 0 ? 'no_candidates'
                  : 'selection_missing';
        const message = code === 'source_search_failed'
          ? sourceSearchFailureMessage(state.sourceFailures)
          : failureMessage(code);
        const retryable = code === 'source_search_failed'
          ? state.sourceFailures.some(({ failure }) => isImmediatelyRetryableSourceFailure(failure))
          : true;
        await handleAttemptFailure(request, code, message, retryable);
        return;
      }
      const publishedAt = input.now();
      const recommendations = state.selected.map((selection, position) => {
        const candidate = state.candidates.get(selection.candidateId);
        if (!candidate) throw new Error(`Selected candidate was not found: ${selection.candidateId}.`);
        return recommendationFromCandidate({
          candidate,
          batchId: request.batchId,
          recommendationId: input.ids.createRecommendationId(),
          recommendationReason: selection.recommendationReason,
          position,
          publishedAt,
        });
      });
      const published = input.repository.publishDailyBatch({
        batchId: request.batchId,
        executionId: request.executionId,
        publishedAt,
        recommendations,
      });
      if (published.status !== 'published') {
        await handleAttemptFailure(request, 'publish_conflict', `Daily discovery publication failed: ${published.reason}.`, false);
      }
    } finally {
      input.attempts.dispose(request.executionId);
    }
  };

  const handleAttemptFailure = async (
    request: { readonly batchId: string; readonly localDate: string; readonly targetCount: number; readonly executionId: string },
    code: string,
    message: string,
    retryable: boolean,
  ): Promise<void> => {
    if (!accepting || !retryable) {
      input.repository.failDailyBatch({
        batchId: request.batchId,
        executionId: request.executionId,
        failureCode: code,
        failureMessage: message,
        failedAt: input.now(),
      });
      return;
    }
    const snapshot = await snapshotInputs();
    if (!snapshot.model || snapshot.interests.length === 0 || snapshot.descriptors.length === 0) {
      input.repository.failDailyBatch({
        batchId: request.batchId,
        executionId: request.executionId,
        failureCode: code,
        failureMessage: message,
        failedAt: input.now(),
      });
      return;
    }
    await startAttempt({
      batchId: request.batchId,
      localDate: request.localDate,
      timezone: input.timezone(),
      targetCount: request.targetCount,
      requestId: `${request.batchId}:retry:${request.executionId}`,
      snapshot,
      claim(nextExecutionId) {
        const retried = input.repository.failDailyAttempt({
          batchId: request.batchId,
          executionId: request.executionId,
          nextExecutionId,
          failureCode: code,
          failureMessage: message,
          failedAt: input.now(),
        });
        if (retried.status === 'retry_claimed') return undefined;
        return failedResult(request.localDate, code, message, false);
      },
    });
  };

  const runtime: DailyDiscoveryRuntime = {
    async start() {
      if (started || !accepting) return;
      ensureIdentityMigration();
      started = true;
      for (const batch of input.repository.listRunningDailyBatches()) {
        const snapshot = await snapshotInputs();
        const operation = startAttempt({
          batchId: batch.batchId,
          localDate: batch.localDate,
          timezone: batch.timezone,
          targetCount: batch.targetCount,
          requestId: `${batch.batchId}:recovery:${batch.executionId}`,
          snapshot,
          claim(nextExecutionId) {
            const recovered = input.repository.failDailyAttempt({
              batchId: batch.batchId,
              executionId: batch.executionId,
              nextExecutionId,
              failureCode: 'attempt_interrupted',
              failureMessage: 'The previous daily discovery attempt was interrupted by application shutdown.',
              failedAt: input.now(),
            });
            return recovered.status === 'retry_claimed'
              ? undefined
              : failedResult(batch.localDate, 'attempt_interrupted', 'The interrupted attempt could not be recovered.', false);
          },
        }).then(() => undefined);
        track(operation, {
          operation: 'startup_recovery',
          batchId: batch.batchId,
          executionId: batch.executionId,
        });
      }
      await scheduler.start();
    },

    async ensure(request) {
      const parsed = EnsureDailyDiscoveryRequestSchema.parse(request);
      const timezone = input.timezone();
      const localDate = localDateAt(parsed.now, timezone);
      const existing = input.repository.getDailyBatch(localDate);
      if (existing?.status === 'published') {
        return {
          status: 'already_published', localDate, batchId: existing.batchId,
          resultCount: existing.resultCount, publishedAt: existing.publishedAt,
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
      } catch (error) {
        return {
          status: 'failed', localDate,
          failure: {
            code: 'content_identity_migration_failed',
            message: error instanceof Error
              ? `Discovery content identities could not be migrated: ${error.message}`
              : 'Discovery content identities could not be migrated.',
            retryable: false,
          },
        };
      }
      const snapshot = await snapshotInputs();
      if (snapshot.interests.length === 0) return { status: 'no_active_interests', localDate };
      if (snapshot.descriptors.length === 0) return { status: 'no_available_sources', localDate };
      if (!snapshot.model) return { status: 'model_unavailable', localDate };

      const batchId = existing?.batchId ?? input.ids.createBatchId();
      const targetCount = Math.max(1, Math.min(100, Math.floor(snapshot.settings.dailyTargetCount)));
      return startAttempt({
        batchId,
        localDate,
        timezone,
        targetCount,
        requestId: `${batchId}:${parsed.trigger}:${parsed.now}`,
        snapshot,
        claim(executionId) {
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
          if (claimed.status === 'claimed') return undefined;
          if (claimed.status === 'already_published') {
            return {
              status: 'already_published', localDate, batchId: claimed.batch.batchId,
              resultCount: claimed.batch.resultCount, publishedAt: claimed.batch.publishedAt,
            };
          }
          if (claimed.status === 'in_progress') {
            return {
              status: 'in_progress', localDate, batchId: claimed.batch.batchId,
              executionId: claimed.batch.executionId,
            };
          }
          return failedResult(
            localDate,
            claimed.batch.failureCode ?? 'database_failed',
            claimed.batch.failureMessage ?? 'Daily discovery batch could not be claimed.',
            true,
          );
        },
      });
    },

    getHome(request) {
      const nextScheduledAt = scheduler.getNextScheduledAt();
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

    getNextScheduledAt: () => scheduler.getNextScheduledAt(),

    async shutdown() {
      accepting = false;
      await scheduler.shutdown();
      while (activePromises.size > 0) await Promise.allSettled([...activePromises]);
    },
  };
  scheduler = createDailyDiscoveryScheduler({
    now: input.now,
    timezone: input.timezone,
    generationTime: () => input.settings.getDiscoverySettings().dailyGenerationTime,
    ensure: (request) => runtime.ensure(request),
    onScheduledError: (error) => reportBackgroundError(error, { operation: 'scheduled_ensure' }),
    ...(input.timers ? { timers: input.timers } : {}),
  });
  return runtime;
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

function discoveryMaterial(input: {
  readonly targetCount: number;
  readonly interests: readonly Interest[];
  readonly descriptors: readonly SourceDescriptor[];
  readonly signals: readonly RecommendationSelectionSignal[];
}): DailyDiscoveryContextMaterial {
  return {
    targetCount: input.targetCount,
    interests: input.interests.map((interest) => ({
      interestId: interest.interestId,
      description: interest.description,
    })),
    sources: input.descriptors.map((descriptor) => ({
      id: descriptor.id,
      name: descriptor.name,
      access: descriptor.access,
      supportedModes: [...descriptor.supportedModes],
    })),
    recommendationSignals: input.signals.map(copySignal),
  };
}

function failedResult(
  localDate: string,
  code: string,
  message: string,
  retryable: boolean,
): EnsureDailyDiscoveryResult {
  return { status: 'failed', localDate, failure: { code, message, retryable } };
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

function copyInterest(interest: Interest): Interest {
  return { ...interest };
}

function copyDescriptor(descriptor: SourceDescriptor): SourceDescriptor {
  return { ...descriptor, supportedModes: [...descriptor.supportedModes] };
}

function copySignal(signal: RecommendationSelectionSignal): RecommendationSelectionSignal {
  return { ...signal };
}
