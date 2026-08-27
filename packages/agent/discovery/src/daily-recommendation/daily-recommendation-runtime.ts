/*
 * Owns the Daily Recommendation lifecycle: snapshots dynamic settings and the Candidate Pool,
 * starts the single Agent execution, and treats terminal Tool publication as the business result.
 */
import { randomUUID } from 'node:crypto';
import type { Api, Model } from '@megumi/ai';
import type { DailyRecommendationContextMaterial } from '@megumi/context';
import type {
  DailyRecommendationExecutionInput,
  ExecutionOutcome,
  StartDailyRecommendationExecutionResult,
} from '@megumi/execution';
import type { Observability, OperationCompletion, TraceCorrelation } from '@megumi/observability';
import type {
  DiscoveryHomeView,
  GetDiscoveryHomeRequest,
  RecommendationView,
  SearchRecommendationsRequest,
  SearchRecommendationsResult,
} from '../discovery-view';
import type { UpdateRecommendationStateRequest } from '../recommendations/recommendation';
import type { DailyRecommendationAttempts } from './daily-recommendation-attempt';
import {
  EnsureDailyRecommendationRequestSchema,
  type DailyRecommendationBatch,
  type DailyRecommendationSnapshot,
  type EnsureDailyRecommendationRequest,
  type EnsureDailyRecommendationResult,
} from './daily-recommendation';
import {
  createDailyRecommendationScheduler,
  localDateAt,
  type DailyRecommendationScheduler,
} from './daily-recommendation-scheduler';
import type { DailyRecommendationRepository } from '../persistence/daily-recommendation-repository';

export interface DailyRecommendationBackgroundErrorContext {
  readonly operation: 'scheduled_ensure' | 'execution_settlement' | 'automatic_retry';
  readonly batchId?: string;
  readonly executionId?: string;
}

export interface CreateDailyRecommendationRuntimeOptions {
  readonly repository: DailyRecommendationRepository;
  readonly attempts: DailyRecommendationAttempts;
  readonly startExecution: <TRejected>(
    request: DailyRecommendationExecutionInput<TRejected>,
  ) => Promise<StartDailyRecommendationExecutionResult<TRejected>>;
  readonly settings: {
    getDiscoverySettings(): {
      readonly dailyGenerationTime: string;
      readonly dailyTargetCount: number;
    };
  };
  readonly timezone: () => string;
  readonly resolveModel: () => Promise<Model<Api> | undefined>;
  readonly ids: {
    createBatchId(): string;
    createRecommendationId(): string;
    createFeedbackId?(): string;
    createFeedbackChangeId?(): string;
  };
  readonly now: () => string;
  readonly notifyCandidateSupply: (shortfall: number) => void;
  readonly observability?: Observability;
  readonly timers?: {
    setTimeout(callback: () => void, delayMs: number): unknown;
    clearTimeout(handle: unknown): void;
  };
  readonly onBackgroundError?: (
    error: unknown,
    context: DailyRecommendationBackgroundErrorContext,
  ) => void;
}

export interface DailyRecommendationRuntime {
  start(): Promise<void>;
  ensure(request: EnsureDailyRecommendationRequest): Promise<EnsureDailyRecommendationResult>;
  notifyCandidatesAvailable(): void;
  getHome(request: GetDiscoveryHomeRequest): DiscoveryHomeView;
  searchRecommendations(request: SearchRecommendationsRequest): SearchRecommendationsResult;
  updateRecommendationState(request: UpdateRecommendationStateRequest): RecommendationView;
  getNextScheduledAt(): string | undefined;
  shutdown(): Promise<void>;
}

type ClaimRejection =
  | { readonly status: 'in_progress'; readonly batch: Extract<DailyRecommendationBatch, { readonly status: 'running' }> }
  | { readonly status: 'already_published'; readonly batch: Extract<DailyRecommendationBatch, { readonly status: 'published' }> }
  | { readonly status: 'failed'; readonly batch: Extract<DailyRecommendationBatch, { readonly status: 'failed' }> }
  | { readonly status: 'attempt_start_failed'; readonly message: string };

interface Acceptance<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

/** Creates the Runtime that consumes only the persisted Candidate Pool. */
export function createDailyRecommendationRuntime(
  options: CreateDailyRecommendationRuntimeOptions,
): DailyRecommendationRuntime {
  let accepting = true;
  const activeLifecycles = new Set<Promise<void>>();
  const activeDates = new Map<string, Promise<EnsureDailyRecommendationResult>>();
  let waitingForCandidatesDate: string | undefined;
  let scheduler: DailyRecommendationScheduler;

  function ensure(request: EnsureDailyRecommendationRequest): Promise<EnsureDailyRecommendationResult> {
    const parsed = EnsureDailyRecommendationRequestSchema.parse(request);
    const localDate = localDateAt(parsed.now, options.timezone());
    const active = activeDates.get(localDate);
    if (active) return active;
    if (!accepting) {
      return Promise.resolve(failed(localDate, 'daily_recommendation_shutting_down', 'Daily Recommendation is shutting down.', false));
    }

    const acceptance = deferred<EnsureDailyRecommendationResult>();
    activeDates.set(localDate, acceptance.promise);
    let retry = false;
    const lifecycle = observeTrace(options.observability, async () => {
      const result = await runLifecycle(options, parsed, localDate, acceptance, (waiting) => {
        if (waiting) waitingForCandidatesDate = localDate;
        else if (waitingForCandidatesDate === localDate) waitingForCandidatesDate = undefined;
      });
      retry = result.retry;
      return result.result;
    }).catch((error) => {
      const result = failed(localDate, 'daily_recommendation_failed', messageOf(error), true);
      acceptance.resolve(result);
      reportBackgroundError(options, error, { operation: 'execution_settlement' });
      return result;
    }).finally(() => {
      activeDates.delete(localDate);
      activeLifecycles.delete(tracked);
      if (retry && accepting) {
        void ensure({ trigger: 'retry', now: options.now() }).catch((error) => {
          reportBackgroundError(options, error, { operation: 'automatic_retry' });
        });
      }
    });
    const tracked = lifecycle.then(() => undefined);
    activeLifecycles.add(tracked);
    return acceptance.promise;
  }

  const runtime: DailyRecommendationRuntime = {
    async start() {
      await scheduler.start();
    },
    ensure,
    notifyCandidatesAvailable() {
      if (!accepting) return;
      void ensure({ trigger: 'candidate_available', now: options.now() }).catch((error) => {
        reportBackgroundError(options, error, { operation: 'automatic_retry' });
      });
    },
    getHome(request) {
      const nextScheduledAt = scheduler.getNextScheduledAt();
      const home = options.repository.readHome({
        ...request,
        localDate: localDateAt(options.now(), options.timezone()),
        ...(nextScheduledAt ? { nextScheduledAt } : {}),
      });
      if (
        home.today.status !== 'not_generated'
        || home.today.localDate !== waitingForCandidatesDate
      ) return home;
      return {
        ...home,
        today: {
          localDate: home.today.localDate,
          status: 'waiting_for_candidates',
          resultCount: 0,
        },
      };
    },
    searchRecommendations: (request) => options.repository.searchRecommendations(request),
    updateRecommendationState(request) {
      const now = options.now();
      return request.action === 'set_reaction'
        ? options.repository.updateRecommendationState({
            ...request,
            now,
            feedbackId: options.ids.createFeedbackId?.() ?? `feedback:${randomUUID()}`,
            feedbackChangeId: options.ids.createFeedbackChangeId?.()
              ?? `feedback-change:${randomUUID()}`,
          })
        : options.repository.updateRecommendationState({ ...request, now });
    },
    getNextScheduledAt: () => scheduler.getNextScheduledAt(),
    async shutdown() {
      accepting = false;
      await scheduler.shutdown();
      await Promise.allSettled([...activeLifecycles]);
    },
  };
  scheduler = createDailyRecommendationScheduler({
    now: options.now,
    timezone: options.timezone,
    generationTime: () => options.settings.getDiscoverySettings().dailyGenerationTime,
    ensure,
    onScheduledError: (error) => reportBackgroundError(options, error, { operation: 'scheduled_ensure' }),
    ...(options.timers ? { timers: options.timers } : {}),
  });
  return runtime;
}

async function runLifecycle(
  options: CreateDailyRecommendationRuntimeOptions,
  request: EnsureDailyRecommendationRequest,
  localDate: string,
  acceptance: Acceptance<EnsureDailyRecommendationResult>,
  setWaitingForCandidates: (waiting: boolean) => void,
): Promise<{ readonly result: EnsureDailyRecommendationResult; readonly retry: boolean }> {
  setWaitingForCandidates(false);
  const current = options.repository.getBatch(localDate);
  if (current?.status === 'published') {
    const result = publishedResult(current);
    acceptance.resolve(result);
    return { result, retry: false };
  }
  if (current?.status === 'running') {
    const result = inProgressResult(current);
    acceptance.resolve(result);
    return { result, retry: false };
  }
  if (current?.status === 'failed' && current.attemptCount >= 3) {
    const result = failed(localDate, current.failureCode, current.failureMessage, false);
    acceptance.resolve(result);
    return { result, retry: false };
  }

  const requestedCount = options.settings.getDiscoverySettings().dailyTargetCount;
  const now = request.now;
  const snapshot = await observeSpan(
    options.observability,
    'candidate.pool.snapshot',
    {},
    () => options.repository.readSnapshot({ now, requestedCount }),
  );
  safeRecordContent(options.observability, 'candidate.pool.snapshot', {
    localDate, requestedCount, snapshot,
  });
  const shortfall = Math.max(0, requestedCount - snapshot.window.availableCount);
  if (shortfall > 0) safeNotifyCandidateSupply(options, shortfall);
  if (snapshot.window.availableCount === 0) {
    setWaitingForCandidates(true);
    const result: EnsureDailyRecommendationResult = {
      status: 'waiting_for_candidates', localDate, requestedCount,
    };
    acceptance.resolve(result);
    return { result, retry: false };
  }

  const model = await observeSpan(options.observability, 'model.resolve', {}, options.resolveModel);
  if (!model) {
    const result: EnsureDailyRecommendationResult = { status: 'model_unavailable', localDate };
    acceptance.resolve(result);
    return { result, retry: false };
  }

  const batchId = current?.batchId ?? options.ids.createBatchId();
  const material = contextMaterial(snapshot);
  safeRecordContent(options.observability, 'discovery.candidates', material.candidates, { batchId });
  let executionId: string | undefined;
  const started = await options.startExecution<ClaimRejection>({
    kind: 'daily_recommendation',
    requestId: `daily-recommendation-request:${randomUUID()}`,
    batchId,
    localDate,
    material,
    model,
    async accept({ executionId: acceptedExecutionId }) {
      executionId = acceptedExecutionId;
      const claimed = await observeSpan(
        options.observability,
        'daily.batch.claim',
        { batchId, executionId: acceptedExecutionId },
        () => options.repository.claimBatch({
          batchId,
          localDate,
          timezone: options.timezone(),
          executionId: acceptedExecutionId,
          requestedCount: material.requestedCount,
          actualTarget: material.actualTarget,
          now,
        }),
      );
      if (claimed.status !== 'claimed') return { status: 'rejected', reason: claimed };
      try {
        options.attempts.start({
          executionId: acceptedExecutionId,
          batchId: claimed.batch.batchId,
          window: snapshot.window,
          repository: options.repository,
          createRecommendationId: options.ids.createRecommendationId,
          now: options.now,
        });
        return { status: 'accepted' };
      } catch (error) {
        options.repository.failBatch({
          batchId: claimed.batch.batchId,
          executionId: acceptedExecutionId,
          failedAt: options.now(),
          failureCode: 'attempt_start_failed',
          failureMessage: messageOf(error),
        });
        return {
          status: 'rejected',
          reason: { status: 'attempt_start_failed', message: messageOf(error) },
        };
      }
    },
    onSettled: () => undefined,
  });

  if (started.status === 'rejected') {
    const result = resultFromClaimRejection(localDate, started.reason);
    acceptance.resolve(result);
    return { result, retry: false };
  }
  if (started.status === 'failed') {
    if (executionId) settleFailure(options, batchId, executionId, started.failure.code, started.failure.message);
    const result = failed(localDate, started.failure.code, started.failure.message, started.failure.retryable);
    acceptance.resolve(result);
    return { result, retry: shouldRetry(options.repository.getBatch(localDate)) };
  }

  if (started.execution.kind !== 'daily_recommendation') {
    const result = failed(
      localDate,
      'execution_kind_mismatch',
      'Daily Recommendation start returned an incompatible execution.',
      false,
    );
    acceptance.resolve(result);
    return { result, retry: false };
  }
  const acceptedExecutionId = started.execution.executionId;
  executionId = acceptedExecutionId;
  const acceptedResult: EnsureDailyRecommendationResult = {
    status: 'started',
    localDate,
    batchId: started.execution.batchId,
    executionId: acceptedExecutionId,
    requestedCount: material.requestedCount,
    actualTarget: material.actualTarget,
  };
  acceptance.resolve(acceptedResult);
  return observeSpan(
    options.observability,
    'daily.attempt.settle',
    { batchId, executionId: acceptedExecutionId },
    async () => {
      const outcome = await started.completion;
      options.attempts.dispose(acceptedExecutionId);
      const authoritative = options.repository.getBatch(localDate);
      if (authoritative?.status === 'published') {
        safeRecordContent(options.observability, 'recommendation.published', authoritative, {
          batchId: authoritative.batchId, executionId: acceptedExecutionId,
        });
        safeNotifyCandidateSupply(options, shortfall);
        return { result: publishedResult(authoritative), retry: false };
      }
      const failure = failureFromOutcome(outcome);
      settleFailure(options, batchId, acceptedExecutionId, failure.code, failure.message);
      const failedBatch = options.repository.getBatch(localDate);
      return {
        result: failed(localDate, failure.code, failure.message, failure.retryable),
        retry: shouldRetry(failedBatch),
      };
    },
  );
}

function contextMaterial(snapshot: DailyRecommendationSnapshot): DailyRecommendationContextMaterial {
  return {
    requestedCount: snapshot.window.requestedCount,
    actualTarget: snapshot.window.actualTarget,
    availableCount: snapshot.window.availableCount,
    readBudget: Math.min(snapshot.window.candidates.length, 20),
    interests: snapshot.activeInterests.map((interest) => ({ ...interest })),
    candidates: snapshot.window.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      contentIdentity: candidate.contentIdentity,
      sourceName: candidate.primarySourceName,
      canonicalUrl: candidate.canonicalUrl,
      contentType: candidate.contentType,
      title: candidate.title,
      ...(candidate.author ? { author: candidate.author } : {}),
      ...(candidate.publishedAt ? { contentPublishedAt: candidate.publishedAt } : {}),
      ...(candidate.description ? { description: candidate.description } : {}),
      relevance: candidate.admission.relevance,
      matchedInterestIds: [...candidate.admission.matchedInterestIds],
      admissionReason: candidate.admission.reason,
    })),
    recentRecommendations: snapshot.recentRecommendations.map(historyItem),
    recentFeedback: snapshot.recentFeedback.map(historyItem),
  };
}

function historyItem(recommendation: DailyRecommendationSnapshot['recentRecommendations'][number]) {
  return {
    contentIdentity: recommendation.contentIdentity,
    sourceName: recommendation.sourceName,
    title: recommendation.title,
    recommendationReason: recommendation.recommendationReason,
    publishedAt: recommendation.publishedAt,
    ...(recommendation.reaction ? { reaction: recommendation.reaction } : {}),
    ...(recommendation.hiddenAt ? { hiddenAt: recommendation.hiddenAt } : {}),
    ...(recommendation.favoriteAt ? { favoriteAt: recommendation.favoriteAt } : {}),
    ...(recommendation.watchLaterAt ? { watchLaterAt: recommendation.watchLaterAt } : {}),
    ...(recommendation.firstOpenedAt ? { firstOpenedAt: recommendation.firstOpenedAt } : {}),
  };
}

function settleFailure(
  options: CreateDailyRecommendationRuntimeOptions,
  batchId: string,
  executionId: string,
  code: string,
  message: string,
): void {
  try {
    options.repository.failBatch({
      batchId, executionId, failedAt: options.now(), failureCode: code, failureMessage: message,
    });
  } catch (error) {
    reportBackgroundError(options, error, { operation: 'execution_settlement', batchId, executionId });
  }
}

function failureFromOutcome(outcome: ExecutionOutcome): {
  readonly code: string; readonly message: string; readonly retryable: boolean;
} {
  if (outcome.status === 'failed') return outcome.failure;
  if (outcome.status === 'cancelled') {
    return { code: 'execution_cancelled', message: 'Daily Recommendation execution was cancelled.', retryable: true };
  }
  return {
    code: 'publication_missing',
    message: 'Daily Recommendation execution completed without publishing Recommendations.',
    retryable: true,
  };
}

function resultFromClaimRejection(localDate: string, reason: ClaimRejection): EnsureDailyRecommendationResult {
  if (reason.status === 'in_progress') return inProgressResult(reason.batch);
  if (reason.status === 'already_published') return publishedResult(reason.batch);
  if (reason.status === 'failed') {
    return failed(localDate, reason.batch.failureCode, reason.batch.failureMessage, false);
  }
  return failed(localDate, 'attempt_start_failed', reason.message, true);
}

function publishedResult(
  batch: Extract<DailyRecommendationBatch, { readonly status: 'published' }>,
): EnsureDailyRecommendationResult {
  return {
    status: 'already_published', localDate: batch.localDate, batchId: batch.batchId,
    resultCount: batch.resultCount, publishedAt: batch.publishedAt,
  };
}

function inProgressResult(
  batch: Extract<DailyRecommendationBatch, { readonly status: 'running' }>,
): EnsureDailyRecommendationResult {
  return {
    status: 'in_progress', localDate: batch.localDate,
    batchId: batch.batchId, executionId: batch.executionId,
  };
}

function failed(
  localDate: string,
  code: string,
  message: string,
  retryable: boolean,
): EnsureDailyRecommendationResult {
  return { status: 'failed', localDate, failure: { code, message, retryable } };
}

function shouldRetry(batch: DailyRecommendationBatch | undefined): boolean {
  return batch?.status === 'failed' && batch.attemptCount < 3;
}

function safeNotifyCandidateSupply(
  options: CreateDailyRecommendationRuntimeOptions,
  shortfall: number,
): void {
  if (shortfall <= 0) return;
  try {
    options.notifyCandidateSupply(shortfall);
  } catch {
    // Supply notification is a separate recovery concern after Daily decisions.
  }
}

async function observeTrace(
  observability: Observability | undefined,
  operation: () => Promise<EnsureDailyRecommendationResult>,
): Promise<EnsureDailyRecommendationResult> {
  let promise: Promise<EnsureDailyRecommendationResult> | undefined;
  const runOnce = () => {
    promise ??= operation();
    return promise;
  };
  if (!observability) return runOnce();
  try {
    return await observability.withTrace({
      kind: 'daily_recommendation',
      classifyResult: classifyDailyRecommendationResult,
    }, runOnce);
  } catch {
    return runOnce();
  }
}

function classifyDailyRecommendationResult(
  result: EnsureDailyRecommendationResult,
): OperationCompletion {
  if (result.status !== 'failed') {
    return { outcome: { status: 'ok', code: result.status } };
  }
  return {
    outcome: {
      status: 'error',
      code: result.failure.code,
      message: result.failure.message,
      retryable: result.failure.retryable,
    },
  };
}

async function observeSpan<T>(
  observability: Observability | undefined,
  name: Parameters<Observability['withSpan']>[0]['name'],
  correlation: TraceCorrelation,
  operation: () => T | Promise<T>,
): Promise<T> {
  let promise: Promise<T> | undefined;
  const runOnce = () => {
    promise ??= Promise.resolve().then(operation);
    return promise;
  };
  if (!observability) return runOnce();
  try {
    return await observability.withSpan({
      name, correlation, classifyResult: (): OperationCompletion => ({ outcome: { status: 'ok' } }),
    }, runOnce);
  } catch {
    return runOnce();
  }
}

function safeRecordContent(
  observability: Observability | undefined,
  kind: Parameters<Observability['recordContent']>[0]['kind'],
  value: unknown,
  correlation?: TraceCorrelation,
): void {
  try {
    observability?.recordContent({ kind, value, ...(correlation ? { correlation } : {}) });
  } catch {
    // Trace content cannot alter Daily Recommendation business state.
  }
}

function reportBackgroundError(
  options: CreateDailyRecommendationRuntimeOptions,
  error: unknown,
  context: DailyRecommendationBackgroundErrorContext,
): void {
  try {
    options.onBackgroundError?.(error, context);
  } catch {
    // The observer is the terminal error boundary.
  }
}

function deferred<T>(): Acceptance<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
