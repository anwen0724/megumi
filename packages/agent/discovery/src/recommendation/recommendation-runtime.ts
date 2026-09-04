/*
 * Owns Recommendation trigger admission, immutable snapshot construction,
 * Agent Core delegation, runtime-only status, and bounded waiting.
 */
import { randomUUID } from 'node:crypto';
import type { Api, Model } from '@megumi/ai';
import type { ExecutionOutcome } from '@megumi/execution';
import { candidatePoolSettings } from '../candidate-supply/candidate-pool';
import type { CandidateSupplyRepository } from '../candidate-supply/candidate-supply';
import type { InterestRepository } from '../persistence/interest-repository';
import type { PreferenceLearningRepository } from '../persistence/preference-learning-repository';
import type { RecommendationRepository } from '../persistence/recommendation-repository';
import { rankRecommendationCandidates } from './recommendation-ranking';
import type { RecommendationAttempts } from './recommendation-attempts';
import type { RecommendationCollection, RecommendationHistoryItem } from './recommendation';
import { createRecommendationScheduler } from './recommendation-scheduler';

export type RecommendationTrigger = 'scheduled' | 'startup_catchup' | 'manual';
export type RecommendationFailureCode =
  | 'settings_invalid'
  | 'snapshot_unavailable'
  | 'agent_execution_failed'
  | 'agent_limit_reached'
  | 'publication_conflict'
  | 'storage_failed';

export interface RecommendationFailure {
  readonly code: RecommendationFailureCode;
  readonly message: string;
  readonly retryable: boolean;
}

export type RequestRecommendationResult =
  | { readonly status: 'started' | 'in_progress'; readonly localDate: string; readonly requestId: string; readonly executionId: string }
  | { readonly status: 'already_published'; readonly collection: RecommendationCollection }
  | { readonly status: 'waiting_for_candidates' | 'model_unavailable'; readonly localDate: string }
  | { readonly status: 'failed'; readonly localDate: string; readonly failure: RecommendationFailure };

export type WaitRecommendationResult =
  | { readonly status: 'published'; readonly collection: RecommendationCollection }
  | { readonly status: 'waiting_for_candidates' | 'model_unavailable' | 'cancelled'; readonly localDate: string }
  | { readonly status: 'failed'; readonly localDate: string; readonly failure: RecommendationFailure }
  | { readonly status: 'timed_out'; readonly localDate: string; readonly requestId: string };

export type TodayRecommendationResult =
  | { readonly status: 'not_generated'; readonly localDate: string }
  | { readonly status: 'running'; readonly localDate: string; readonly requestId: string; readonly executionId: string }
  | WaitRecommendationResult;

interface RecommendationSettings {
  readonly recommendationCandidateCheckIntervalSeconds: number;
  readonly recommendationGenerationTime: string;
  readonly recommendationTargetCount: number;
  readonly recommendationWorkingSetCount: number;
  readonly candidatePoolMinimumCount: number;
  readonly candidatePoolMaximumCount: number;
  readonly candidateValidityDays: number;
  readonly candidateContentExcerptMaxCharacters: number;
}

type RecommendationDataRepository = RecommendationRepository & CandidateSupplyRepository
  & InterestRepository & PreferenceLearningRepository;

export interface RecommendationExecutionInput<TRejected = unknown> {
  readonly kind: 'recommendation';
  readonly requestId: string;
  readonly localDate: string;
  readonly model: Model<Api>;
  accept(request: { readonly executionId: string }): Promise<
    { readonly status: 'accepted' } | { readonly status: 'rejected'; readonly reason: TRejected }
  >;
  onSettled(request: { readonly executionId: string; readonly outcome: ExecutionOutcome }): void | Promise<void>;
}

export type StartRecommendationExecutionResult<TRejected = unknown> =
  | { readonly status: 'started' | 'already_started'; readonly execution: { readonly kind: string; readonly executionId: string }; readonly completion: Promise<ExecutionOutcome> }
  | { readonly status: 'rejected'; readonly reason: TRejected }
  | { readonly status: 'failed'; readonly failure: { readonly code: string; readonly message: string; readonly retryable: boolean } };

export interface CreateRecommendationRuntimeOptions {
  readonly repository: RecommendationDataRepository;
  readonly attempts: RecommendationAttempts;
  readonly sourceRegistry: {
    get(sourceId: string): { readonly descriptor: { readonly name: string } } | undefined;
  };
  readonly startExecution: <TRejected>(
    request: RecommendationExecutionInput<TRejected>,
  ) => Promise<StartRecommendationExecutionResult<TRejected>>;
  readonly resolveModel: () => Promise<
    { readonly status: 'ok'; readonly model: Model<Api> } | { readonly status: 'unavailable' }
  >;
  readonly settings: { readonly resolve: () => RecommendationSettings };
  readonly clock: { readonly now: () => string };
  readonly timezone: { readonly get: () => string };
  readonly ids?: { readonly createRequestId: () => string };
  readonly timers?: {
    setTimeout(callback: () => void, delayMs: number): unknown;
    clearTimeout(handle: unknown): void;
  };
  readonly onBackgroundError?: (error: unknown, context: {
    readonly operation: 'scheduled_request' | 'execution_settlement' | 'automatic_retry';
    readonly requestId?: string;
    readonly executionId?: string;
  }) => void;
}

export interface RecommendationRuntime {
  start(options?: { readonly automaticTriggers?: boolean }): Promise<void>;
  request(request: { readonly trigger: RecommendationTrigger }): Promise<RequestRecommendationResult>;
  wait(request: { readonly requestId: string; readonly timeoutMs: number }): Promise<WaitRecommendationResult>;
  getToday(): TodayRecommendationResult;
  getNextScheduledAt(): string | undefined;
  shutdown(): Promise<void>;
}

interface ActiveRequest {
  readonly trigger: RecommendationTrigger;
  readonly requestId: string;
  readonly localDate: string;
  executionId?: string;
  readonly executionReady: Promise<string | undefined>;
  retryCount: number;
  retryTimer?: unknown;
  readonly completion: Promise<WaitRecommendationResult>;
  markExecutionStarted(executionId: string): void;
  settle(result: WaitRecommendationResult): void;
}

/** Creates Recommendation's process-local coordinator around the single Agent Core owner. */
export function createRecommendationRuntime(options: CreateRecommendationRuntimeOptions): RecommendationRuntime {
  const ids = options.ids ?? { createRequestId: () => `recommendation-request:${randomUUID()}` };
  let active: ActiveRequest | undefined;
  let latest: { readonly requestId: string; readonly result: WaitRecommendationResult } | undefined;
  let starting: Promise<RequestRecommendationResult> | undefined;
  let shuttingDown = false;
  let lastCheck: TodayRecommendationResult | undefined;
  let candidateWait: { readonly localDate: string; readonly trigger: RecommendationTrigger } | undefined;
  let candidateWaitTimer: unknown;

  /** Discards only input waiting; it never cancels an Agent Core execution. */
  function clearCandidateWait(): void {
    if (candidateWaitTimer !== undefined) runtimeTimers(options).clearTimeout(candidateWaitTimer);
    candidateWaitTimer = undefined;
    candidateWait = undefined;
  }

  /** Arms one local-only recheck after the previous request has fully settled. */
  function scheduleCandidateWait(localDate: string, trigger: RecommendationTrigger): void {
    if (shuttingDown || localDateAt(options.clock.now(), options.timezone.get()) !== localDate) {
      clearCandidateWait();
      return;
    }
    if (candidateWaitTimer !== undefined && candidateWait?.localDate === localDate) return;
    clearCandidateWait();
    const seconds = options.settings.resolve().recommendationCandidateCheckIntervalSeconds;
    if (!Number.isInteger(seconds) || seconds <= 0) throw new Error('Invalid candidate check interval.');
    const waiting = { localDate, trigger };
    candidateWait = waiting;
    candidateWaitTimer = runtimeTimers(options).setTimeout(() => {
      candidateWaitTimer = undefined;
      void recheckCandidates(waiting);
    }, Math.min(seconds * 1_000, 2_147_483_647));
  }

  /** Reuses request serialization without promoting a previous day's waiting into new work. */
  async function recheckCandidates(waiting: NonNullable<typeof candidateWait>): Promise<void> {
    try {
      if (shuttingDown || candidateWait !== waiting) return;
      if (localDateAt(options.clock.now(), options.timezone.get()) !== waiting.localDate) {
        clearCandidateWait();
        return;
      }
      await requestRecommendation({ trigger: waiting.trigger }, waiting.localDate);
    } catch (error) {
      clearCandidateWait();
      lastCheck = failureResult(waiting.localDate, 'snapshot_unavailable', 'Recommendation input could not be checked.', false);
      try {
        options.onBackgroundError?.(error, { operation: 'scheduled_request' });
      } catch {
        // A diagnostic observer cannot turn a stopped recheck into an unhandled background failure.
      }
    }
  }

  const startRecommendation = async (
    request: { readonly trigger: RecommendationTrigger },
    expectedLocalDate?: string,
  ): Promise<RequestRecommendationResult> => {
    const snapshotAt = options.clock.now();
    const localDate = localDateAt(snapshotAt, options.timezone.get());
    const published = options.repository.getCollection(localDate, true);
    if (published) return { status: 'already_published', collection: published };
    if (active) {
      const current = active;
      const executionId = current.executionId ?? await current.executionReady;
      if (!executionId) {
        return failureResult(
          current.localDate,
          'agent_execution_failed',
          'Recommendation execution could not be started.',
          false,
        );
      }
      return {
        status: 'in_progress', localDate: current.localDate,
        requestId: current.requestId, executionId,
      };
    }
    if (shuttingDown) return failureResult(localDate, 'agent_execution_failed', 'Recommendation is shutting down.', false);

    let settings: RecommendationSettings;
    try {
      settings = validateSettings(options.settings.resolve());
    } catch {
      return failureResult(localDate, 'settings_invalid', 'Recommendation settings are invalid.', false);
    }
    let prepared: ReturnType<typeof prepareSnapshot>;
    try {
      prepared = prepareSnapshot(options, snapshotAt, localDate, settings);
    } catch {
      return failureResult(localDate, 'snapshot_unavailable', 'Recommendation snapshot could not be created.', true);
    }
    if (prepared.ranking.actualTargetCount === 0) return { status: 'waiting_for_candidates', localDate };

    const model = await options.resolveModel();
    if (shuttingDown) return failureResult(localDate, 'agent_execution_failed', 'Recommendation is shutting down.', false);
    if (expectedLocalDate && localDateAt(options.clock.now(), options.timezone.get()) !== expectedLocalDate) {
      return { status: 'waiting_for_candidates', localDate: expectedLocalDate };
    }
    if (model.status === 'unavailable') return { status: 'model_unavailable', localDate };
    clearCandidateWait();

    const requestId = ids.createRequestId();
    active = createActiveRequest(requestId, localDate, request.trigger);
    const started = await options.startExecution({
      kind: 'recommendation',
      requestId,
      localDate,
      model: model.model,
      async accept({ executionId }) {
        if (!active || active.requestId !== requestId) return { status: 'rejected', reason: 'ownership_lost' };
        active.markExecutionStarted(executionId);
        options.attempts.start({
          requestId,
          executionId,
          localDate,
          snapshotAt,
          actualTarget: prepared.ranking.actualTargetCount,
          workingSetCount: settings.recommendationWorkingSetCount,
          rankedCandidates: prepared.ranking.rankedCandidates,
          exclusions: prepared.ranking.exclusions,
          interestRevisions: prepared.interestRevisions,
          preferenceRevisions: prepared.preferenceRevisions,
          interests: prepared.interests,
          preferences: prepared.preferences,
          history: prepared.history,
          repository: options.repository,
          now: options.clock.now,
        });
        return { status: 'accepted' };
      },
      onSettled: ({ executionId, outcome }) => {
        void handleSettlement(requestId, executionId, outcome);
      },
    });
    if (started.status === 'rejected') {
      const result = failureResult(localDate, 'agent_execution_failed', 'Recommendation execution lost ownership.', false);
      active.settle(result);
      latest = { requestId, result };
      active = undefined;
      return result;
    }
    if (started.status === 'failed') {
      const result = failureResult(localDate, 'agent_execution_failed', started.failure.message, started.failure.retryable);
      active.settle(result);
      latest = { requestId, result };
      active = undefined;
      return result;
    }
    if (active) active.markExecutionStarted(started.execution.executionId);
    return { status: 'started', localDate, requestId, executionId: started.execution.executionId };
  };

  const requestRecommendation = async (
    request: { readonly trigger: RecommendationTrigger },
    expectedLocalDate?: string,
  ): Promise<RequestRecommendationResult> => {
    if (starting) {
      const result = await starting;
      if (result.status !== 'started' && result.status !== 'in_progress') return result;
      const collection = options.repository.getCollection(result.localDate, true);
      if (collection) return { status: 'already_published', collection };
      if (active?.requestId === result.requestId && active.executionId) {
        return {
          status: 'in_progress',
          localDate: active.localDate,
          requestId: active.requestId,
          executionId: active.executionId,
        };
      }
      return failureResult(
        result.localDate,
        'agent_execution_failed',
        'Recommendation execution finished before it could be joined.',
        false,
      );
    }
    const operation = startRecommendation(request, expectedLocalDate);
    starting = operation;
    try {
      const result = await operation;
      if (result.status === 'waiting_for_candidates') {
        lastCheck = result;
        scheduleCandidateWait(result.localDate, request.trigger);
      } else {
        clearCandidateWait();
        if (result.status === 'failed' || result.status === 'model_unavailable') lastCheck = result;
        else lastCheck = undefined;
      }
      return result;
    } finally {
      if (starting === operation) starting = undefined;
    }
  };

  async function handleSettlement(
    requestId: string,
    executionId: string,
    outcome: ExecutionOutcome,
  ): Promise<void> {
    options.attempts.dispose(executionId);
    const current = active;
    if (!current || current.requestId !== requestId || current.executionId !== executionId) return;
    const collection = options.repository.getCollection(current.localDate, true);
    if (collection) {
      complete(current, { status: 'published', collection });
      return;
    }
    if (outcome.status === 'failed' && outcome.failure.retryable && current.retryCount < 2) {
      const delayMs = current.retryCount === 0 ? 5_000 : 30_000;
      current.retryCount += 1;
      current.retryTimer = runtimeTimers(options).setTimeout(() => {
        current.retryTimer = undefined;
        void retry(current).catch((error) => {
          options.onBackgroundError?.(error, {
            operation: 'automatic_retry',
            requestId: current.requestId,
            executionId: current.executionId,
          });
          complete(current, failureResult(
            current.localDate,
            'agent_execution_failed',
            error instanceof Error ? error.message : 'Recommendation retry failed.',
            false,
          ));
        });
      }, delayMs);
      return;
    }
    const result = outcome.status === 'cancelled'
      ? { status: 'cancelled' as const, localDate: current.localDate }
      : failureResult(
          current.localDate,
          outcome.status === 'failed' && outcome.failure.code === 'loop_limit_exceeded'
            ? 'agent_limit_reached'
            : 'agent_execution_failed',
          outcome.status === 'failed'
            ? outcome.failure.message
            : 'Agent completed without publishing Recommendation.',
          false,
        );
    complete(current, result);
  }

  async function retry(current: ActiveRequest): Promise<void> {
    if (active !== current || shuttingDown) return;
    const published = options.repository.getCollection(current.localDate, true);
    if (published) {
      complete(current, { status: 'published', collection: published });
      return;
    }
    let settings: RecommendationSettings;
    try {
      settings = validateSettings(options.settings.resolve());
    } catch {
      complete(current, failureResult(current.localDate, 'settings_invalid', 'Recommendation settings are invalid.', false));
      return;
    }
    const resolvedModel = await options.resolveModel();
    if (resolvedModel.status === 'unavailable') {
      complete(current, { status: 'model_unavailable', localDate: current.localDate });
      return;
    }
    const snapshotAt = options.clock.now();
    let prepared: ReturnType<typeof prepareSnapshot>;
    try {
      prepared = prepareSnapshot(options, snapshotAt, current.localDate, settings);
    } catch {
      complete(current, failureResult(
        current.localDate,
        'snapshot_unavailable',
        'Recommendation snapshot could not be created.',
        false,
      ));
      return;
    }
    if (prepared.ranking.actualTargetCount === 0) {
      complete(current, { status: 'waiting_for_candidates', localDate: current.localDate });
      return;
    }
    const started = await options.startExecution({
      kind: 'recommendation',
      requestId: current.requestId,
      localDate: current.localDate,
      model: resolvedModel.model,
      async accept({ executionId }) {
        if (active !== current) return { status: 'rejected', reason: 'ownership_lost' };
        current.executionId = executionId;
        options.attempts.start({
          requestId: current.requestId,
          executionId,
          localDate: current.localDate,
          snapshotAt,
          actualTarget: prepared.ranking.actualTargetCount,
          workingSetCount: settings.recommendationWorkingSetCount,
          rankedCandidates: prepared.ranking.rankedCandidates,
          exclusions: prepared.ranking.exclusions,
          interestRevisions: prepared.interestRevisions,
          preferenceRevisions: prepared.preferenceRevisions,
          interests: prepared.interests,
          preferences: prepared.preferences,
          history: prepared.history,
          repository: options.repository,
          now: options.clock.now,
        });
        return { status: 'accepted' };
      },
      onSettled: ({ executionId, outcome }) => {
        void handleSettlement(current.requestId, executionId, outcome);
      },
    });
    if (started.status === 'started' || started.status === 'already_started') {
      current.executionId = started.execution.executionId;
      return;
    }
    if (started.status === 'rejected') {
      complete(current, failureResult(
        current.localDate,
        'agent_execution_failed',
        'Recommendation execution lost ownership.',
        false,
      ));
      return;
    }
    if ('failure' in started) {
      await handleSettlement(current.requestId, current.executionId ?? '', {
        status: 'failed',
        failure: {
          code: 'internal_error',
          message: started.failure.message,
          retryable: started.failure.retryable,
        },
      });
    }
  }

  function complete(current: ActiveRequest, result: WaitRecommendationResult): void {
    if (active !== current) return;
    current.settle(result);
    latest = { requestId: current.requestId, result };
    active = undefined;
    lastCheck = result;
    if (result.status === 'waiting_for_candidates') scheduleCandidateWait(result.localDate, current.trigger);
  }

  const scheduler = createRecommendationScheduler({
    now: options.clock.now,
    timezone: options.timezone.get,
    generationTime: () => options.settings.resolve().recommendationGenerationTime,
    ensure: requestRecommendation,
    onScheduledError: (error) => options.onBackgroundError?.(error, { operation: 'scheduled_request' }),
    ...(options.timers ? { timers: options.timers } : {}),
  });

  return {
    async start(startOptions = {}) {
      if (startOptions.automaticTriggers ?? true) await scheduler.start();
    },
    request: requestRecommendation,
    async wait(request) {
      if (!active || active.requestId !== request.requestId) {
        if (latest?.requestId === request.requestId) return latest.result;
        return failureResult(localDateAt(options.clock.now(), options.timezone.get()), 'agent_execution_failed', 'Recommendation request was not found.', false);
      }
      return waitFor(active, request.timeoutMs);
    },
    getToday() {
      const localDate = localDateAt(options.clock.now(), options.timezone.get());
      const collection = options.repository.getCollection(localDate, true);
      if (collection) return { status: 'published', collection };
      if (active && active.localDate === localDate && active.executionId) {
        return { status: 'running', localDate, requestId: active.requestId, executionId: active.executionId };
      }
      if (lastCheck && 'localDate' in lastCheck && lastCheck.localDate === localDate) return lastCheck;
      if (latest && 'localDate' in latest.result && latest.result.localDate === localDate) return latest.result;
      return { status: 'not_generated', localDate };
    },
    getNextScheduledAt: () => scheduler.getNextScheduledAt(),
    async shutdown() {
      shuttingDown = true;
      clearCandidateWait();
      await scheduler.shutdown();
      if (active) {
        if (active.retryTimer !== undefined) runtimeTimers(options).clearTimeout(active.retryTimer);
        const result = { status: 'cancelled' as const, localDate: active.localDate };
        active.settle(result);
        latest = { requestId: active.requestId, result };
        active = undefined;
      }
    },
  };
}

function prepareSnapshot(
  options: CreateRecommendationRuntimeOptions,
  snapshotAt: string,
  localDate: string,
  settings: RecommendationSettings,
) {
  const pool = options.repository.getCandidatePoolSnapshot(candidatePoolSettings({
    minimumCount: settings.candidatePoolMinimumCount,
    maximumCount: settings.candidatePoolMaximumCount,
    candidateValidityDays: settings.candidateValidityDays,
    candidateContentExcerptMaxCharacters: settings.candidateContentExcerptMaxCharacters,
  }));
  const interests = options.repository.listNonDeletedInterests().filter(({ status }) => status === 'active');
  const preferences = options.repository.listPreferenceSnapshots();
  const history = options.repository.listRecommendationHistory('1970-01-01T00:00:00.000Z');
  const rankingHistory: RecommendationHistoryItem[] = history.map((item) => ({
    recommendationId: item.id,
    candidateId: item.candidateId,
    contentIdentity: item.contentIdentity,
    sourceId: item.content.sourceId,
    contentType: item.content.contentType,
    matchedInterestIds: item.selectionBasis.matchedInterestIds,
    publishedAt: item.publishedAt,
  }));
  const ranking = rankRecommendationCandidates({
    snapshotAt,
    targetCount: settings.recommendationTargetCount,
    workingSetCount: settings.recommendationWorkingSetCount,
    candidates: pool.candidates.map((entry) => ({
      ...entry,
      sourceName: options.sourceRegistry.get(entry.candidate.sourceId)?.descriptor.name ?? '',
    })),
    history: rankingHistory,
  });
  return {
    localDate,
    interests,
    preferences,
    history,
    ranking,
    interestRevisions: interests.map(({ interestId, revision }) => ({ interestId, revision })),
    preferenceRevisions: preferences.map(({ scopeKey, revision }) => ({ scopeKey, revision })),
  };
}

function validateSettings(settings: RecommendationSettings): RecommendationSettings {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(settings.recommendationGenerationTime)) throw new Error('time');
  const values = [
    settings.recommendationCandidateCheckIntervalSeconds,
    settings.recommendationTargetCount,
    settings.recommendationWorkingSetCount,
    settings.candidatePoolMinimumCount,
    settings.candidatePoolMaximumCount,
    settings.candidateValidityDays,
    settings.candidateContentExcerptMaxCharacters,
  ];
  if (values.some((value) => !Number.isInteger(value) || value <= 0)) throw new Error('count');
  if (settings.recommendationTargetCount > 100
    || settings.recommendationTargetCount > settings.recommendationWorkingSetCount
    || settings.recommendationWorkingSetCount > settings.candidatePoolMaximumCount
    || settings.candidatePoolMinimumCount > settings.candidatePoolMaximumCount) {
    throw new Error('bounds');
  }
  return settings;
}

function createActiveRequest(requestId: string, localDate: string, trigger: RecommendationTrigger): ActiveRequest {
  let resolve!: (result: WaitRecommendationResult) => void;
  const completion = new Promise<WaitRecommendationResult>((settle) => { resolve = settle; });
  let resolveExecution!: (executionId: string | undefined) => void;
  const executionReady = new Promise<string | undefined>((settle) => { resolveExecution = settle; });
  let executionResolved = false;
  let settled = false;
  return {
    requestId,
    trigger,
    localDate,
    executionReady,
    retryCount: 0,
    completion,
    markExecutionStarted(executionId) {
      this.executionId = executionId;
      if (executionResolved) return;
      executionResolved = true;
      resolveExecution(executionId);
    },
    settle(result) {
      if (settled) return;
      settled = true;
      if (!executionResolved) {
        executionResolved = true;
        resolveExecution(undefined);
      }
      resolve(result);
    },
  };
}

function runtimeTimers(options: CreateRecommendationRuntimeOptions) {
  return options.timers ?? {
    setTimeout: (callback: () => void, delayMs: number) => setTimeout(callback, delayMs),
    clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}

async function waitFor(active: ActiveRequest, timeoutMs: number): Promise<WaitRecommendationResult> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new Error('timeoutMs must be a positive integer.');
  let handle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<WaitRecommendationResult>((resolve) => {
    handle = setTimeout(() => resolve({
      status: 'timed_out', localDate: active.localDate, requestId: active.requestId,
    }), timeoutMs);
  });
  const result = await Promise.race([active.completion, timeout]);
  if (handle) clearTimeout(handle);
  return result;
}

function failureResult(
  localDate: string,
  code: RecommendationFailureCode,
  message: string,
  retryable: boolean,
): Extract<RequestRecommendationResult, { readonly status: 'failed' }> {
  return { status: 'failed', localDate, failure: { code, message, retryable } };
}

export function localDateAt(instant: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(instant));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
