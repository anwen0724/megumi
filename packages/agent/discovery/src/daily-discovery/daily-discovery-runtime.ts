/*
 * Owns daily preflight, Batch and Attempt lifecycle, publication, and retry coordination.
 */
import { type Api, type Model } from '@megumi/ai';
import type { DailyDiscoveryContextMaterial } from '@megumi/context';
import type {
  DailyDiscoveryExecutionInput,
  ExecutionOutcome,
  StartDailyDiscoveryExecutionResult,
} from '@megumi/execution';
import {
  createContentDigest,
  type ContentKind,
  type Observability,
  type OperationCompletion,
  type TraceCorrelation,
  type TraceEvent,
  type TraceLinkKind,
  type TraceLinkTarget,
} from '@megumi/observability';
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
  readonly observability?: Observability;
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
  /** Starts identity migration, interrupted-Attempt recovery, and scheduling exactly once. */
  start(): Promise<void>;
  /** Ensures the local-date Batch according to the requested trigger. */
  ensure(request: EnsureDailyDiscoveryRequest): Promise<EnsureDailyDiscoveryResult>;
  /** Reads the current local Home projection with scheduling metadata. */
  getHome(request: GetDiscoveryHomeRequest): DiscoveryHomeView;
  /** Searches already persisted Recommendations. */
  searchRecommendations(request: SearchRecommendationsRequest): SearchRecommendationsResult;
  /** Applies one user-controlled Recommendation state change. */
  updateRecommendationState(request: UpdateRecommendationStateRequest): RecommendationView;
  /** Returns the next scheduled generation timestamp when scheduling is active. */
  getNextScheduledAt(): string | undefined;
  /** Stops scheduling and drains owned Attempt settlement and recovery work. */
  shutdown(): Promise<void>;
}

type DailyLifecycleResult = OperationCompletion;

type AttemptSettlement =
  | { readonly status: 'complete'; readonly completion: DailyLifecycleResult }
  | {
      readonly status: 'retry';
      readonly executionId: string;
      readonly code: string;
      readonly message: string;
      readonly retryable: true;
    };

/** Creates the Daily Discovery coordinator over the shared Agent Execution entry point. */
export function createDailyDiscoveryRuntime(input: CreateDailyDiscoveryRuntimeOptions & {
  readonly now: () => string;
}): DailyDiscoveryRuntime {
  const activePromises = new Set<Promise<void>>();
  let accepting = true;
  let started = false;
  let identitiesMigrated = false;
  let scheduler: DailyDiscoveryScheduler;

  /** Runs the idempotent identity migration before any read or generation work. */
  const ensureIdentityMigration = (): void => {
    if (identitiesMigrated) return;
    input.repository.migrateRecommendationIdentities();
    identitiesMigrated = true;
  };

  /** Delivers background failures to the terminal observer without creating a second failure. */
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

  /** Owns a background Promise until settlement and reports its rejection exactly once. */
  const track = (
    operation: Promise<void>,
    context: DailyDiscoveryBackgroundErrorContext | (() => DailyDiscoveryBackgroundErrorContext),
  ): void => {
    let tracked!: Promise<void>;
    tracked = (async () => {
      try {
        await operation;
      } catch (error) {
        reportBackgroundError(error, typeof context === 'function' ? context() : context);
      } finally {
        activePromises.delete(tracked);
      }
    })();
    activePromises.add(tracked);
  };

  /** Captures stable generation inputs before an Attempt enters the shared Agent Execution path. */
  const snapshotInputs = async (correlation: TraceCorrelation) => observeOperation(
    input.observability,
    'discovery.preflight',
    correlation,
    () => ({ outcome: { status: 'ok' } }),
    async () => {
      const interests = input.repository.listInterests().filter((interest) => interest.status === 'active');
      const settings = input.settings.getDiscoverySettings();
      await input.sourceRegistry.checkSources(settings.enabledSources, input.observability);
      const descriptors = enabledDescriptors(input.sourceRegistry, settings.enabledSources);
      const model = await observeOperation(
        input.observability,
        'model.resolve',
        correlation,
        (resolved) => resolved
          ? { outcome: { status: 'ok' } }
          : { outcome: { status: 'error', code: 'model_unavailable', message: 'Daily discovery model is unavailable.' } },
        input.resolveModel,
      );
      return { interests, settings, descriptors, model };
    },
  );

  /** Starts one Agent Execution and keeps its Attempt Span open through settlement. */
  const startAttempt = async (request: {
    readonly batchId: string;
    readonly localDate: string;
    readonly targetCount: number;
    readonly requestId: string;
    readonly attemptNumber: number;
    readonly snapshot: Awaited<ReturnType<typeof snapshotInputs>>;
    readonly claim: (executionId: string) => EnsureDailyDiscoveryResult | undefined;
    readonly onAccepted?: (result: EnsureDailyDiscoveryResult) => void;
  }): Promise<AttemptSettlement> => {
    const { snapshot } = request;
    if (!snapshot.model || snapshot.interests.length === 0 || snapshot.descriptors.length === 0) {
      const result = failedResult(
        request.localDate,
        'agent_execution_failed',
        'Daily discovery prerequisites are unavailable.',
        false,
      );
      request.onAccepted?.(result);
      return completeFromEnsureResult(result);
    }
    const signals = input.repository.listRecommendationSelectionSignals().map(copySignal);
    const material = discoveryMaterial({
      targetCount: request.targetCount,
      interests: snapshot.interests,
      descriptors: snapshot.descriptors,
      signals,
    });
    const attemptCorrelation = {
      requestId: request.requestId,
      batchId: request.batchId,
      discoveryAttempt: request.attemptNumber,
    };
    safeRecordContent(input.observability, 'discovery.material', material, attemptCorrelation);
    const settlement = deferred<AttemptSettlement>();
    const started = await input.startExecution<EnsureDailyDiscoveryResult>({
      kind: 'daily_discovery',
      requestId: request.requestId,
      batchId: request.batchId,
      localDate: request.localDate,
      material,
      model: snapshot.model,
      async accept({ executionId }) {
        const correlation = { ...attemptCorrelation, executionId };
        const rejected = await observeOperation(
          input.observability,
          'discovery.batch.claim',
          correlation,
          (result) => result
            ? completionFromEnsureResult(result)
            : { outcome: { status: 'ok', code: 'claimed' }, correlation },
          async () => request.claim(executionId),
        );
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
            reason: failedResult(
              request.localDate,
              'attempt_start_failed',
              'Daily discovery attempt could not start.',
              false,
            ),
          };
        }
      },
      onSettled({ executionId, outcome }) {
        const correlation = { ...attemptCorrelation, executionId };
        const operation = observeOperation(
          input.observability,
          'discovery.attempt.settle',
          correlation,
          classifyAttemptSettlement,
          () => settleAttempt({
            batchId: request.batchId,
            localDate: request.localDate,
            targetCount: request.targetCount,
            executionId,
            outcome,
          }),
        );
        void operation.then(settlement.resolve, settlement.reject);
        return operation.then(() => undefined);
      },
    });
    if (started.status === 'rejected') {
      request.onAccepted?.(started.reason);
      return completeFromEnsureResult(started.reason);
    }
    if (started.status === 'failed') {
      const result = failedResult(
        request.localDate,
        'agent_execution_failed',
        started.failure.message,
        started.failure.retryable,
      );
      request.onAccepted?.(result);
      return completeFromEnsureResult(result);
    }
    request.onAccepted?.({
      status: 'started',
      localDate: request.localDate,
      batchId: request.batchId,
      executionId: started.execution.executionId,
    });
    const result = await settlement.promise;
    if (result.status === 'retry') {
      safeRecordEvent(input.observability, {
        type: 'discovery.retry.scheduled',
        currentAttempt: request.attemptNumber,
        nextAttempt: request.attemptNumber + 1,
        reasonCode: result.code,
      });
    }
    return result;
  };

  /** Converts one terminal Agent outcome into publication or a retry instruction. */
  const settleAttempt = async (request: {
    readonly batchId: string;
    readonly localDate: string;
    readonly targetCount: number;
    readonly executionId: string;
    readonly outcome: ExecutionOutcome;
  }): Promise<AttemptSettlement> => {
    try {
      if (request.outcome.status !== 'completed') {
        const message = request.outcome.status === 'cancelled'
          ? 'Daily discovery Agent execution was cancelled.'
          : request.outcome.failure.message;
        const settled = handleAttemptFailure(
          request,
          'agent_execution_failed',
          message,
          request.outcome.status === 'failed' && request.outcome.failure.retryable,
        );
        return request.outcome.status === 'cancelled' && settled.status === 'complete'
          ? {
              status: 'complete',
              completion: {
                outcome: { status: 'cancelled', code: 'agent_execution_cancelled', message },
                correlation: { batchId: request.batchId, executionId: request.executionId },
              },
            }
          : settled;
      }
      const state = input.attempts.snapshot(request.executionId);
      if (!state) {
        return handleAttemptFailure(
          request,
          'attempt_not_found',
          'Daily discovery attempt state was lost.',
          false,
        );
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
        return handleAttemptFailure(request, code, message, retryable);
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
      const recommendationDigest = createContentDigest(recommendations);
      const correlation = {
        batchId: request.batchId,
        executionId: request.executionId,
        recommendationIds: recommendations.map((item) => item.recommendationId),
        ...(recommendationDigest ? { contentDigest: recommendationDigest } : {}),
      };
      safeRecordContent(input.observability, 'discovery.recommendations', recommendations, correlation);
      const published = await observeOperation(
        input.observability,
        'recommendation.publish',
        correlation,
        classifyPublication,
        async () => publishRecommendations({
          batchId: request.batchId,
          executionId: request.executionId,
          publishedAt,
          recommendations,
        }),
      );
      if (published.status !== 'published') {
        return handleAttemptFailure(
          request,
          'publish_conflict',
          `Daily discovery publication failed: ${published.reason}.`,
          false,
        );
      }
      return {
        status: 'complete',
        completion: { outcome: { status: 'ok', code: 'published' }, correlation },
      };
    } finally {
      input.attempts.dispose(request.executionId);
    }
  };

  /** Publishes one selected set and delegates unexpected persistence failures to Batch finalization. */
  const publishRecommendations = (
    command: Parameters<DailyBatchRepository['publishDailyBatch']>[0],
  ): ReturnType<DailyBatchRepository['publishDailyBatch']> => {
    try {
      return input.repository.publishDailyBatch(command);
    } catch (error) {
      return terminatePublicationFailure(command, error);
    }
  };

  /** Closes a failed publication without hiding its original infrastructure error. */
  const terminatePublicationFailure = (
    request: { readonly batchId: string; readonly executionId: string },
    publicationError: unknown,
  ): never => {
    try {
      input.repository.failDailyBatch({
        batchId: request.batchId,
        executionId: request.executionId,
        failureCode: 'publication_failed',
        failureMessage: 'Daily discovery recommendations could not be published.',
        failedAt: input.now(),
      });
    } catch (finalizationError) {
      throw new AggregateError(
        [publicationError, finalizationError],
        'Daily discovery publication and Batch finalization both failed.',
      );
    }
    throw publicationError;
  };

  /** Finalizes one failed Attempt or returns the existing bounded retry instruction. */
  const handleAttemptFailure = (
    request: { readonly batchId: string; readonly localDate: string; readonly executionId: string },
    code: string,
    message: string,
    retryable: boolean,
  ): AttemptSettlement => {
    const batch = input.repository.getDailyBatch(request.localDate);
    if (accepting
      && retryable
      && batch?.status === 'running'
      && batch.executionId === request.executionId
      && batch.automaticRetryCount < 2) {
      return { status: 'retry', executionId: request.executionId, code, message, retryable: true };
    }
    input.repository.failDailyBatch({
      batchId: request.batchId,
      executionId: request.executionId,
      failureCode: code,
      failureMessage: message,
      failedAt: input.now(),
    });
    return {
      status: 'complete',
      completion: {
        outcome: { status: 'error', code, message, retryable },
        correlation: { batchId: request.batchId, executionId: request.executionId },
      },
    };
  };

  /** Runs every automatic Attempt as a sibling Span inside one root Trace. */
  const runAttemptLoop = async (request: {
    readonly batchId: string;
    readonly localDate: string;
    readonly targetCount: number;
    readonly requestId: string;
    readonly attemptNumber: number;
    readonly snapshot: Awaited<ReturnType<typeof snapshotInputs>>;
    readonly claim: (executionId: string) => EnsureDailyDiscoveryResult | undefined;
    readonly onAccepted?: (result: EnsureDailyDiscoveryResult) => void;
  }): Promise<DailyLifecycleResult> => {
    let attemptNumber = request.attemptNumber;
    let snapshot = request.snapshot;
    let attemptRequestId = request.requestId;
    let claim = request.claim;
    let onAccepted = request.onAccepted;
    while (true) {
      const correlation = {
        requestId: attemptRequestId,
        batchId: request.batchId,
        discoveryAttempt: attemptNumber,
      };
      const result = await observeOperation(
        input.observability,
        'discovery.attempt',
        correlation,
        classifyAttemptSettlement,
        () => startAttempt({
          batchId: request.batchId,
          localDate: request.localDate,
          targetCount: request.targetCount,
          requestId: attemptRequestId,
          attemptNumber,
          snapshot,
          claim,
          ...(onAccepted ? { onAccepted } : {}),
        }),
      );
      onAccepted = undefined;
      if (result.status === 'complete') return result.completion;

      const nextCorrelation = {
        batchId: request.batchId,
        executionId: result.executionId,
        discoveryAttempt: attemptNumber + 1,
      };
      snapshot = await snapshotInputs(nextCorrelation);
      if (!snapshot.model || snapshot.interests.length === 0 || snapshot.descriptors.length === 0) {
        input.repository.failDailyBatch({
          batchId: request.batchId,
          executionId: result.executionId,
          failureCode: result.code,
          failureMessage: result.message,
          failedAt: input.now(),
        });
        return {
          outcome: {
            status: 'error',
            code: result.code,
            message: result.message,
            retryable: false,
          },
          correlation: nextCorrelation,
        };
      }
      const previousExecutionId = result.executionId;
      attemptNumber += 1;
      attemptRequestId = `${request.batchId}:retry:${previousExecutionId}`;
      claim = (nextExecutionId) => {
        const retried = input.repository.failDailyAttempt({
          batchId: request.batchId,
          executionId: previousExecutionId,
          nextExecutionId,
          failureCode: result.code,
          failureMessage: result.message,
          failedAt: input.now(),
        });
        return retried.status === 'retry_claimed'
          ? undefined
          : failedResult(request.localDate, result.code, result.message, false);
      };
    }
  };

  const runtime: DailyDiscoveryRuntime = {
    async start() {
      if (started || !accepting) return;
      ensureIdentityMigration();
      started = true;
      for (const batch of input.repository.listRunningDailyBatches()) {
        const requestId = `${batch.batchId}:recovery:${batch.executionId}`;
        const operation = observeDailyTrace(
          input.observability,
          { requestId, batchId: batch.batchId },
          async () => {
            safeLinkTrace(input.observability, 'continues', {
              by: 'correlation',
              traceKind: 'daily_discovery',
              correlation: { batchId: batch.batchId, executionId: batch.executionId },
              state: 'latest_incomplete',
            }, { batchId: batch.batchId, executionId: batch.executionId });
            const snapshot = await snapshotInputs({ requestId, batchId: batch.batchId });
            return runAttemptLoop({
              batchId: batch.batchId,
              localDate: batch.localDate,
              targetCount: batch.targetCount,
              requestId,
              attemptNumber: batch.attemptCount + 1,
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
                  : failedResult(
                      batch.localDate,
                      'attempt_interrupted',
                      'The interrupted attempt could not be recovered.',
                      false,
                    );
              },
            });
          },
        ).then(() => undefined);
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
      const requestId = `daily:${localDate}:${parsed.trigger}:${parsed.now}`;
      const acceptance = deferred<EnsureDailyDiscoveryResult>();
      let backgroundContext: DailyDiscoveryBackgroundErrorContext = { operation: 'attempt_settlement' };
      let accepted = false;
      const resolveAcceptance = (result: EnsureDailyDiscoveryResult): void => {
        accepted = true;
        if (result.status === 'started') {
          backgroundContext = {
            operation: 'attempt_settlement',
            batchId: result.batchId,
            executionId: result.executionId,
          };
        }
        acceptance.resolve(result);
      };
      const finish = (result: EnsureDailyDiscoveryResult): DailyLifecycleResult => {
        resolveAcceptance(result);
        return completionFromEnsureResult(result);
      };
      let lifecycle = observeDailyTrace(
        input.observability,
        {
          requestId,
          ...(existing ? { batchId: existing.batchId, executionId: existing.executionId } : {}),
        },
        async () => {
          if (existing?.status === 'published') {
            safeLinkTrace(input.observability, 'duplicate', {
              by: 'correlation',
              traceKind: 'daily_discovery',
              correlation: { batchId: existing.batchId },
              state: 'latest_ended',
            }, { batchId: existing.batchId });
            return finish({
              status: 'already_published', localDate, batchId: existing.batchId,
              resultCount: existing.resultCount, publishedAt: existing.publishedAt,
            });
          }
          if (existing?.status === 'running') {
            safeLinkTrace(input.observability, 'duplicate', {
              by: 'correlation',
              traceKind: 'daily_discovery',
              correlation: { batchId: existing.batchId, executionId: existing.executionId },
              state: 'active',
            }, { batchId: existing.batchId, executionId: existing.executionId });
            return finish({
              status: 'in_progress',
              localDate,
              batchId: existing.batchId,
              executionId: existing.executionId,
            });
          }
          if (existing?.status === 'failed' && parsed.trigger !== 'manual' && parsed.trigger !== 'retry') {
            return finish({
              status: 'failed', localDate,
              failure: {
                code: existing.failureCode ?? 'agent_execution_failed',
                message: existing.failureMessage ?? 'Daily discovery failed.',
                retryable: true,
              },
            });
          }
          if (!accepting) {
            return finish({
              status: 'failed', localDate,
              failure: { code: 'shutting_down', message: 'Daily discovery is shutting down.', retryable: false },
            });
          }

          try {
            ensureIdentityMigration();
          } catch (error) {
            return finish({
              status: 'failed', localDate,
              failure: {
                code: 'content_identity_migration_failed',
                message: error instanceof Error
                  ? `Discovery content identities could not be migrated: ${error.message}`
                  : 'Discovery content identities could not be migrated.',
                retryable: false,
              },
            });
          }
          const snapshot = await snapshotInputs({ requestId, ...(existing ? { batchId: existing.batchId } : {}) });
          if (snapshot.interests.length === 0) return finish({ status: 'no_active_interests', localDate });
          if (snapshot.descriptors.length === 0) return finish({ status: 'no_available_sources', localDate });
          if (!snapshot.model) return finish({ status: 'model_unavailable', localDate });

          const batchId = existing?.batchId ?? input.ids.createBatchId();
          if (existing?.status === 'failed') {
            safeLinkTrace(input.observability, 'retries', {
              by: 'correlation',
              traceKind: 'daily_discovery',
              correlation: { batchId },
              state: 'latest_ended',
            }, { batchId });
          }
          const targetCount = Math.max(1, Math.min(100, Math.floor(snapshot.settings.dailyTargetCount)));
          return runAttemptLoop({
            batchId,
            localDate,
            targetCount,
            requestId: `${batchId}:${parsed.trigger}:${parsed.now}`,
            attemptNumber: (existing?.attemptCount ?? 0) + 1,
            snapshot,
            onAccepted: resolveAcceptance,
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
      );
      lifecycle = lifecycle.catch((error) => {
        const shouldReportAsBackground = accepted;
        acceptance.reject(error);
        if (shouldReportAsBackground) throw error;
        return {
          outcome: {
            status: 'error',
            code: 'daily_discovery_failed',
            message: error instanceof Error ? error.message : 'Daily discovery failed.',
          },
        };
      });
      track(lifecycle.then(() => undefined), () => backgroundContext);
      return acceptance.promise;
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
      && availability.state === 'ready'
    ))
    .map(({ descriptor }) => descriptor);
}

/** Builds the immutable business Context material supplied to Daily Discovery instructions. */
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

/** Freezes one selected execution candidate into its durable Recommendation snapshot. */
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

/** Preserves distinct Source failures so operators can diagnose an empty Daily Batch. */
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

async function observeDailyTrace(
  observability: Observability | undefined,
  correlation: TraceCorrelation,
  operation: () => Promise<DailyLifecycleResult>,
): Promise<DailyLifecycleResult> {
  let operationPromise: Promise<DailyLifecycleResult> | undefined;
  const runOnce = () => {
    operationPromise ??= operation();
    return operationPromise;
  };
  if (!observability) return runOnce();
  try {
    return await observability.withTrace({
      kind: 'daily_discovery',
      correlation,
      classifyResult: (result) => result,
    }, runOnce);
  } catch {
    return runOnce();
  }
}

async function observeOperation<T>(
  observability: Observability | undefined,
  name: Parameters<Observability['withSpan']>[0]['name'],
  correlation: TraceCorrelation,
  classifyResult: (result: T) => OperationCompletion,
  operation: () => T | Promise<T>,
): Promise<T> {
  let operationPromise: Promise<T> | undefined;
  const runOnce = () => {
    operationPromise ??= Promise.resolve().then(operation);
    return operationPromise;
  };
  if (!observability) return runOnce();
  try {
    return await observability.withSpan({ name, correlation, classifyResult }, runOnce);
  } catch {
    return runOnce();
  }
}

function classifyAttemptSettlement(result: AttemptSettlement): OperationCompletion {
  return result.status === 'complete'
    ? result.completion
    : {
        outcome: { status: 'ok', code: 'retry_scheduled' },
        correlation: { executionId: result.executionId },
      };
}

function classifyPublication(
  result: ReturnType<DailyBatchRepository['publishDailyBatch']>,
): OperationCompletion {
  return result.status === 'published'
    ? {
        outcome: { status: 'ok', code: 'published' },
        correlation: {
          batchId: result.batch.batchId,
          executionId: result.batch.executionId,
          recommendationIds: result.recommendations.map((item) => item.recommendationId),
        },
      }
    : {
        outcome: {
          status: 'error',
          code: 'publish_conflict',
          message: `Daily discovery publication failed: ${result.reason}.`,
          retryable: false,
        },
      };
}

function completeFromEnsureResult(result: EnsureDailyDiscoveryResult): AttemptSettlement {
  return { status: 'complete', completion: completionFromEnsureResult(result) };
}

function completionFromEnsureResult(result: EnsureDailyDiscoveryResult): OperationCompletion {
  if (result.status === 'failed') {
    return {
      outcome: {
        status: 'error',
        code: result.failure.code,
        message: result.failure.message,
        retryable: result.failure.retryable,
      },
    };
  }
  const correlation = 'batchId' in result
    ? {
        batchId: result.batchId,
        ...('executionId' in result ? { executionId: result.executionId } : {}),
      }
    : undefined;
  return {
    outcome: { status: 'ok', code: result.status },
    ...(correlation ? { correlation } : {}),
  };
}

function safeRecordContent(
  observability: Observability | undefined,
  kind: ContentKind,
  value: unknown,
  correlation: TraceCorrelation,
): void {
  try {
    observability?.recordContent({ kind, value, correlation });
  } catch {
    // Daily Discovery remains authoritative when diagnostics are unavailable.
  }
}

function safeRecordEvent(observability: Observability | undefined, event: TraceEvent): void {
  try {
    observability?.recordEvent(event);
  } catch {
    // Retry coordination remains authoritative when diagnostics are unavailable.
  }
}

function safeLinkTrace(
  observability: Observability | undefined,
  kind: TraceLinkKind,
  target: TraceLinkTarget,
  correlation: TraceCorrelation,
): void {
  try {
    observability?.linkTrace({ kind, target, correlation });
  } catch {
    // Trace linkage is diagnostic metadata and cannot alter product behavior.
  }
}

function deferred<T>() {
  let settled = false;
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve(value: T) {
      if (settled) return;
      settled = true;
      resolvePromise(value);
    },
    reject(reason?: unknown) {
      if (settled) return;
      settled = true;
      rejectPromise(reason);
    },
  };
}
