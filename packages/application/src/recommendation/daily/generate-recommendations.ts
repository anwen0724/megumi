/* Coordinates daily preparation, Agent execution, publication and bounded business retries. */
import type { Agent, AgentResult } from '@megumi/agent';
import { randomUUID } from 'node:crypto';
import type { Observability, OperationCompletion } from '../../observability/index';
import type { Settings } from '../../settings/settings-store';
import type { CandidateSupplyRepository } from '../candidates/candidate-pool';
import type { InterestRepository } from '../interests/interest-storage';
import type { PreparePreferencesResult } from '../preferences/preference-learning';
import type { PreferenceSetDetail } from '../preferences/preference-rules';
import type { PreferenceLearningRepository } from '../preferences/preference-storage';
import type { DiscoveryRecommendationFactsResult } from '../recommendation-contracts';
import { createRecommendationScheduler } from '../recommendation-schedule';
import type { RecommendationRepository } from '../recommendation-storage';
import { type CandidateWorkset } from './candidate-workset';
import { createRecommendationContext, recommendationFacts } from './prepare-context';
import {
  prepareRecommendationRun,
  prepareRecommendationSnapshot,
  type RecommendationPreparation,
} from './prepare-run';
import type { RecommendationCollection } from './publish-recommendations';
import { publishRecommendations } from './publish-recommendations';

export type RecommendationTrigger = 'scheduled' | 'startup_catchup' | 'manual';

export type RecommendationFailureCode =
  | 'settings_invalid'
  | 'snapshot_unavailable'
  | 'agent_execution_failed'
  | 'agent_limit_reached'
  | 'publication_conflict'
  | 'storage_failed'
  | 'input_changed';

export interface RecommendationFailure {
  readonly code: RecommendationFailureCode;
  readonly message: string;
  readonly retryable: boolean;
}

export type RequestRecommendationResult =
  | {
      readonly status: 'started' | 'in_progress';
      readonly localDate: string;
      readonly requestId: string;
      readonly phase: 'preparing_preferences' | 'executing';
      readonly executionId?: string;
    }
  | { readonly status: 'already_published'; readonly collection: RecommendationCollection }
  | { readonly status: 'waiting_for_candidates' | 'model_unavailable'; readonly localDate: string }
  | {
      readonly status: 'failed';
      readonly localDate: string;
      readonly failure: RecommendationFailure;
    };

export type WaitRecommendationResult =
  | { readonly status: 'published'; readonly collection: RecommendationCollection }
  | {
      readonly status: 'waiting_for_candidates' | 'model_unavailable' | 'cancelled';
      readonly localDate: string;
    }
  | {
      readonly status: 'failed';
      readonly localDate: string;
      readonly failure: RecommendationFailure;
    }
  | { readonly status: 'timed_out'; readonly localDate: string; readonly requestId: string };

export type TodayRecommendationResult =
  | { readonly status: 'not_generated'; readonly localDate: string }
  | {
      readonly status: 'running';
      readonly localDate: string;
      readonly requestId: string;
      readonly phase: 'preparing_preferences' | 'executing';
      readonly executionId?: string;
    }
  | WaitRecommendationResult;

export interface RecommendationSettings {
  readonly recommendationModel?: { providerId: string; modelId: string };
  readonly recommendationCandidateCheckIntervalSeconds: number;
  readonly recommendationGenerationTime: string;
  readonly recommendationTargetCount: number;
  readonly recommendationWorkingSetCount: number;
  readonly candidatePoolMinimumCount: number;
  readonly candidatePoolMaximumCount: number;
  readonly candidateValidityDays: number;
  readonly candidateContentExcerptMaxCharacters: number;
}

type RecommendationDataRepository = RecommendationRepository &
  CandidateSupplyRepository &
  InterestRepository &
  PreferenceLearningRepository;

export interface CreateRecommendationsOptions {
  /** Read-only projection of already validated preferences; production defaults to the complete source. */
  readonly preferenceSource?: (
    effective: readonly PreferenceSetDetail[],
  ) => readonly PreferenceSetDetail[];
  /** Prepares pending preference inputs after recommendation admission, before freezing its snapshot. */
  readonly preparePreferences?: (request: {
    requestId: string;
    signal: AbortSignal;
  }) => Promise<PreparePreferencesResult | void>;
  readonly observability?: Observability;
  readonly repository: RecommendationDataRepository;
  readonly preparation: RecommendationPreparation;
  readonly sourceRegistry: {
    get(sourceId: string): { readonly descriptor: { readonly name: string } } | undefined;
  };
  readonly agent: Agent;
  readonly settings: Pick<Settings, 'readSettings'>;
  readonly clock: { readonly now: () => string };
  readonly timezone: { readonly get: () => string };
  readonly ids?: { readonly createRequestId: () => string };
  readonly timers?: {
    setTimeout(callback: () => void, delayMs: number): unknown;
    clearTimeout(handle: unknown): void;
  };
  readonly onBackgroundError?: (
    error: unknown,
    context: {
      readonly operation: 'scheduled_request' | 'execution_settlement' | 'automatic_retry';
      readonly requestId?: string;
      readonly executionId?: string;
    },
  ) => void;
}

export interface Recommendations {
  start(options?: { readonly automaticTriggers?: boolean }): Promise<void>;
  updateSchedule(): void;
  generate(request: {
    readonly trigger: RecommendationTrigger;
  }): Promise<RequestRecommendationResult>;
  wait(request: {
    readonly requestId: string;
    readonly timeoutMs: number;
  }): Promise<WaitRecommendationResult>;
  getToday(): TodayRecommendationResult;
  getFacts(request: {
    executionId: string;
    requestId: string;
    localDate: string;
  }): DiscoveryRecommendationFactsResult;
  getNextScheduledAt(): string | undefined;
  shutdown(): Promise<void>;
}

interface ActiveRequest {
  readonly controller: AbortController;
  inputRetryCount: number;
  readonly trigger: RecommendationTrigger;
  readonly requestId: string;
  readonly localDate: string;
  executionId?: string;
  workset?: CandidateWorkset;
  retryCount: number;
  retryTimer?: unknown;
  readonly completion: Promise<WaitRecommendationResult>;
  markExecutionStarted(executionId: string): void;
  settle(result: WaitRecommendationResult): void;
}

/** Creates Recommendation's process-local coordinator around the single Agent Core owner. */
export function createRecommendations(options: CreateRecommendationsOptions): Recommendations {
  const ids = options.ids ?? { createRequestId: () => `recommendation-request:${randomUUID()}` };
  let active: ActiveRequest | undefined;
  let latest: { readonly requestId: string; readonly result: WaitRecommendationResult } | undefined;
  let starting: Promise<RequestRecommendationResult> | undefined;
  let shuttingDown = false;
  let lastCheck: TodayRecommendationResult | undefined;
  let candidateWait:
    | { readonly localDate: string; readonly trigger: RecommendationTrigger }
    | undefined;
  let candidateWaitTimer: unknown;
  const runTasks = new Set<Promise<void>>();
  const traceTasks = new Set<Promise<unknown>>();
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
    const seconds = readConfiguration(options.settings).discovery
      .recommendationCandidateCheckIntervalSeconds;
    if (!Number.isInteger(seconds) || seconds <= 0)
      throw new Error('Invalid candidate check interval.');
    const waiting = { localDate, trigger };
    candidateWait = waiting;
    candidateWaitTimer = runtimeTimers(options).setTimeout(
      () => {
        candidateWaitTimer = undefined;
        void recheckCandidates(waiting);
      },
      Math.min(seconds * 1_000, 2_147_483_647),
    );
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
      lastCheck = failureResult(
        waiting.localDate,
        'snapshot_unavailable',
        'Recommendation input could not be checked.',
        false,
      );
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
    observedRequestId?: string,
  ): Promise<RequestRecommendationResult> => {
    const snapshotAt = options.clock.now();
    const localDate = localDateAt(snapshotAt, options.timezone.get());
    const published = options.repository.getCollection(localDate, true);
    if (published) return { status: 'already_published', collection: published };
    if (active) {
      const current = active;
      return {
        status: 'in_progress',
        localDate: current.localDate,
        requestId: current.requestId,
        phase: current.executionId ? 'executing' : 'preparing_preferences',
        executionId: current.executionId,
      };
    }
    if (shuttingDown)
      return failureResult(
        localDate,
        'agent_execution_failed',
        'Recommendation is shutting down.',
        false,
      );

    let settings: RecommendationSettings;
    try {
      settings = readConfiguration(options.settings).discovery;
    } catch {
      return failureResult(
        localDate,
        'settings_invalid',
        'Recommendation settings are invalid.',
        false,
      );
    }
    let prepared: ReturnType<typeof prepareRecommendationSnapshot>;
    try {
      prepared = prepareRecommendationSnapshot({ ...options, snapshotAt, localDate, settings });
    } catch {
      return failureResult(
        localDate,
        'snapshot_unavailable',
        'Recommendation snapshot could not be created.',
        true,
      );
    }
    if (prepared.ranking.actualTargetCount === 0)
      return { status: 'waiting_for_candidates', localDate };

    if (shuttingDown)
      return failureResult(
        localDate,
        'agent_execution_failed',
        'Recommendation is shutting down.',
        false,
      );
    if (
      expectedLocalDate &&
      localDateAt(options.clock.now(), options.timezone.get()) !== expectedLocalDate
    ) {
      return { status: 'waiting_for_candidates', localDate: expectedLocalDate };
    }
    clearCandidateWait();

    const requestId = observedRequestId ?? ids.createRequestId();
    try {
      options.observability?.recordContent({
        kind: 'discovery.candidates',
        value: prepared,
        correlation: { requestId },
      });
    } catch {
      /* Observation cannot affect snapshot admission. */
    }
    active = createActiveRequest(requestId, localDate, request.trigger);
    launchAttempt(active);
    return { status: 'started', localDate, requestId, phase: 'preparing_preferences' };
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
      if (active?.requestId === result.requestId) {
        return {
          status: 'in_progress',
          phase: active.executionId ? 'executing' : 'preparing_preferences',
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
    const operation = observeRecommendation(request, expectedLocalDate);
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

  /** Acknowledges startup promptly but keeps the business Trace open through settlement and Agent shutdown. */
  function observeRecommendation(
    request: { readonly trigger: RecommendationTrigger },
    expectedLocalDate?: string,
  ): Promise<RequestRecommendationResult> {
    if (!options.observability || active) return startRecommendation(request, expectedLocalDate);
    const requestId = ids.createRequestId();
    let resolveAccepted!: (result: RequestRecommendationResult) => void;
    let rejectAccepted!: (error: unknown) => void;
    const accepted = new Promise<RequestRecommendationResult>((resolve, reject) => {
      resolveAccepted = resolve;
      rejectAccepted = reject;
    });
    let work: Promise<RequestRecommendationResult | WaitRecommendationResult> | undefined;
    const runOnce = () =>
      (work ??= (async () => {
        try {
          const result = await startRecommendation(request, expectedLocalDate, requestId);
          resolveAccepted(result);
          const completion = active?.requestId === requestId ? active.completion : undefined;
          const final = completion
            ? await completion
            : latest?.requestId === requestId
              ? latest.result
              : result;
          return final;
        } catch (error) {
          rejectAccepted(error);
          throw error;
        }
      })());
    const traced = (async () => {
      try {
        await options.observability!.withTrace(
          {
            kind: 'recommendation',
            correlation: { requestId },
            classifyResult: classifyRecommendation,
          },
          runOnce,
        );
      } catch {
        await runOnce();
      }
    })()
      .catch((error: unknown) => {
        rejectAccepted(error);
      })
      .finally(() => {
        traceTasks.delete(traced);
      });
    traceTasks.add(traced);
    return accepted;
  }

  /** Tracks the complete product attempt, including preparation, Agent cleanup and publication. */
  function launchAttempt(current: ActiveRequest): void {
    const task = executeAttempt(current)
      .catch((error: unknown) => {
        complete(
          current,
          current.controller.signal.aborted
            ? { status: 'cancelled', localDate: current.localDate }
            : failureResult(
                current.localDate,
                'agent_execution_failed',
                error instanceof Error ? error.message : 'Recommendation execution failed.',
                false,
              ),
        );
        try {
          options.onBackgroundError?.(error, {
            operation: 'execution_settlement',
            requestId: current.requestId,
            executionId: current.executionId,
          });
        } catch {
          // Diagnostics cannot change the settled business result.
        }
      })
      .finally(() => runTasks.delete(task));
    runTasks.add(task);
  }

  async function handleSettlement(
    requestId: string,
    executionId: string,
    outcome: AgentResult,
    workset: CandidateWorkset,
  ): Promise<void> {
    const current = active;
    if (!current || current.requestId !== requestId || current.executionId !== executionId) {
      return;
    }
    current.workset = undefined;
    let publication: ReturnType<typeof publishRecommendations> | undefined;
    try {
      if (outcome.status === 'completed') {
        publication = publishRecommendations({
          workset,
          repository: options.repository,
          publishedAt: options.clock.now(),
          signal: current.controller.signal,
        });
      }
    } catch (error) {
      complete(
        current,
        failureResult(
          current.localDate,
          'storage_failed',
          error instanceof Error ? error.message : 'Recommendation publication failed.',
          false,
        ),
      );
      return;
    }
    if (publication?.status === 'published' || publication?.status === 'already_published') {
      complete(current, { status: 'published', collection: publication.collection });
      return;
    }
    if (publication?.status === 'cancelled') {
      complete(current, { status: 'cancelled', localDate: current.localDate });
      return;
    }
    if (publication?.status === 'conflict') {
      complete(
        current,
        failureResult(
          current.localDate,
          'publication_conflict',
          'Selected candidates are no longer available.',
          false,
        ),
      );
      return;
    }
    if (publication?.status === 'input_changed') {
      if (current.inputRetryCount >= 1) {
        complete(
          current,
          failureResult(
            current.localDate,
            'input_changed',
            'User requirements changed repeatedly.',
            false,
          ),
        );
        return;
      }
      current.inputRetryCount += 1;
      await executeAttempt(current);
      return;
    }
    if (
      !current.controller.signal.aborted &&
      outcome.status === 'failed' &&
      outcome.error.retryable &&
      current.retryCount < 2
    ) {
      const delayMs = current.retryCount === 0 ? 5_000 : 30_000;
      current.retryCount += 1;
      current.retryTimer = runtimeTimers(options).setTimeout(() => {
        current.retryTimer = undefined;
        launchAttempt(current);
      }, delayMs);
      return;
    }
    const result =
      outcome.status === 'cancelled'
        ? { status: 'cancelled' as const, localDate: current.localDate }
        : failureResult(
            current.localDate,
            outcome.status === 'failed' && outcome.error.code === 'EXECUTION_LIMIT_REACHED'
              ? 'agent_limit_reached'
              : 'agent_execution_failed',
            outcome.status === 'failed'
              ? outcome.error.message
              : 'Agent completed without an accepted recommendation draft.',
            false,
          );
    complete(current, result);
  }

  async function executeAttempt(current: ActiveRequest): Promise<void> {
    if (active !== current) return;
    if (current.controller.signal.aborted) {
      complete(current, { status: 'cancelled', localDate: current.localDate });
      return;
    }
    const published = options.repository.getCollection(current.localDate, true);
    if (published) {
      complete(current, { status: 'published', collection: published });
      return;
    }
    let settings: RecommendationSettings;
    try {
      settings = readConfiguration(options.settings).discovery;
    } catch {
      complete(
        current,
        failureResult(
          current.localDate,
          'settings_invalid',
          'Recommendation settings are invalid.',
          false,
        ),
      );
      return;
    }
    const admission = prepareRecommendationSnapshot({
      ...options,
      snapshotAt: options.clock.now(),
      localDate: current.localDate,
      settings,
    });
    if (admission.ranking.actualTargetCount === 0) {
      complete(current, { status: 'waiting_for_candidates', localDate: current.localDate });
      return;
    }
    current.executionId = undefined;
    current.workset = undefined;
    const preferencePreparation = await options.preparePreferences?.({
      requestId: current.requestId,
      signal: current.controller.signal,
    });
    if (preferencePreparation) {
      try {
        options.observability?.recordContent({
          kind: 'preference.preparation',
          value: {
            status: preferencePreparation.status,
            scopeResults: preferencePreparation.scopeResults,
            failures: preferencePreparation.failures,
          },
          correlation: { requestId: current.requestId },
        });
      } catch {
        /* Diagnostics do not change preparation or publication. */
      }
    }
    if (active !== current) return;
    if (current.controller.signal.aborted) {
      complete(current, { status: 'cancelled', localDate: current.localDate });
      return;
    }
    if (localDateAt(options.clock.now(), options.timezone.get()) !== current.localDate) {
      complete(current, { status: 'cancelled', localDate: current.localDate });
      await requestRecommendation({ trigger: current.trigger });
      return;
    }
    const snapshotAt = options.clock.now();
    let prepared: ReturnType<typeof prepareRecommendationSnapshot>;
    try {
      prepared = prepareRecommendationSnapshot({
        ...options,
        snapshotAt,
        localDate: current.localDate,
        settings,
      });
    } catch {
      complete(
        current,
        failureResult(
          current.localDate,
          'snapshot_unavailable',
          'Recommendation snapshot could not be created.',
          false,
        ),
      );
      return;
    }
    if (prepared.ranking.actualTargetCount === 0) {
      complete(current, { status: 'waiting_for_candidates', localDate: current.localDate });
      return;
    }
    const execution = await prepareRecommendationRun(
      {
        modelSelection: settings.recommendationModel,
        signal: current.controller.signal,
        observability: options.observability,
        snapshot: {
          requestId: current.requestId,
          localDate: current.localDate,
          snapshotAt,
          ...(preferencePreparation ? { preferencePreparation } : {}),
          actualTarget: prepared.ranking.actualTargetCount,
          workingSetCount: settings.recommendationWorkingSetCount,
          rankedCandidates: prepared.ranking.rankedCandidates,
          exclusions: prepared.ranking.exclusions,
          interestRevisions: prepared.interestRevisions,
          preferenceRevisions: prepared.preferenceRevisions,
          preferenceGuard: prepared.preferenceGuard,
          interests: prepared.interests,
          preferences: prepared.preferences,
          history: prepared.history,
        },
      },
      options.preparation,
    );
    if (!execution) {
      complete(current, { status: 'model_unavailable', localDate: current.localDate });
      return;
    }
    const { config, workset } = execution;
    const run = options.agent.startAgent({
      config,
      signal: current.controller.signal,
      input: {
        role: 'user',
        content: 'Generate today’s recommendations.',
        timestamp: Date.parse(snapshotAt),
      },
      context: createRecommendationContext({
        snapshot: workset.getSnapshot(),
        instructionDocuments: options.preparation.instructionDocuments,
      }),
    });
    current.workset = workset;
    current.markExecutionStarted(run.runId);
    const outcome = await run.completion;
    await handleSettlement(current.requestId, run.runId, outcome, workset);
  }

  function complete(current: ActiveRequest, result: WaitRecommendationResult): void {
    if (active !== current) return;
    current.settle(result);
    latest = { requestId: current.requestId, result };
    active = undefined;
    lastCheck = result;
    if (result.status === 'waiting_for_candidates')
      scheduleCandidateWait(result.localDate, current.trigger);
  }

  const scheduler = createRecommendationScheduler({
    now: options.clock.now,
    timezone: options.timezone.get,
    generationTime: () =>
      readConfiguration(options.settings).discovery.recommendationGenerationTime,
    ensure: requestRecommendation,
    onScheduledError: (error) =>
      options.onBackgroundError?.(error, { operation: 'scheduled_request' }),
    ...(options.timers ? { timers: options.timers } : {}),
  });

  return {
    async start(startOptions = {}) {
      if (startOptions.automaticTriggers ?? true) await scheduler.start();
    },
    generate: requestRecommendation,
    async wait(request) {
      if (!active || active.requestId !== request.requestId) {
        if (latest?.requestId === request.requestId) return latest.result;
        return failureResult(
          localDateAt(options.clock.now(), options.timezone.get()),
          'agent_execution_failed',
          'Recommendation request was not found.',
          false,
        );
      }
      return waitFor(active, request.timeoutMs);
    },
    getFacts(request) {
      if (
        active?.executionId !== request.executionId ||
        active.requestId !== request.requestId ||
        active.localDate !== request.localDate ||
        !active.workset
      ) {
        return {
          status: 'failed',
          failure: {
            code: 'recommendation_attempt_not_found',
            message: 'The requested recommendation facts are unavailable.',
          },
        };
      }
      return { status: 'ok', facts: recommendationFacts(active.workset.getSnapshot()) };
    },
    getToday() {
      const localDate = localDateAt(options.clock.now(), options.timezone.get());
      const collection = options.repository.getCollection(localDate, true);
      if (collection) return { status: 'published', collection };
      if (active && active.localDate === localDate) {
        return {
          status: 'running',
          localDate,
          requestId: active.requestId,
          phase: active.executionId ? 'executing' : 'preparing_preferences',
          executionId: active.executionId,
        };
      }
      if (lastCheck && 'localDate' in lastCheck && lastCheck.localDate === localDate)
        return lastCheck;
      if (latest && 'localDate' in latest.result && latest.result.localDate === localDate)
        return latest.result;
      return { status: 'not_generated', localDate };
    },
    updateSchedule() {
      scheduler.updateSchedule();
      const waiting = candidateWait;
      if (waiting) {
        clearCandidateWait();
        scheduleCandidateWait(waiting.localDate, waiting.trigger);
      }
    },
    getNextScheduledAt: () => scheduler.getNextScheduledAt(),
    async shutdown() {
      shuttingDown = true;
      clearCandidateWait();
      const current = active;
      if (current) {
        current.controller.abort();
        if (current.retryTimer !== undefined) {
          runtimeTimers(options).clearTimeout(current.retryTimer);
          current.retryTimer = undefined;
          complete(current, { status: 'cancelled', localDate: current.localDate });
        }
      }
      await scheduler.shutdown();
      await starting;
      await Promise.allSettled([...runTasks]);
      await Promise.allSettled([...traceTasks]);
    },
  };
}

function classifyRecommendation(
  result: RequestRecommendationResult | WaitRecommendationResult,
): OperationCompletion {
  if (result.status === 'failed')
    return {
      outcome: { status: 'error', code: result.failure.code, message: result.failure.message },
    };
  if (result.status === 'cancelled') return { outcome: { status: 'cancelled' } };
  return { outcome: { status: 'ok', code: result.status } };
}

function createActiveRequest(
  requestId: string,
  localDate: string,
  trigger: RecommendationTrigger,
): ActiveRequest {
  let resolve!: (result: WaitRecommendationResult) => void;
  const completion = new Promise<WaitRecommendationResult>((settle) => {
    resolve = settle;
  });
  let settled = false;
  return {
    requestId,
    trigger,
    localDate,
    controller: new AbortController(),
    inputRetryCount: 0,
    retryCount: 0,
    completion,
    markExecutionStarted(executionId) {
      this.executionId = executionId;
    },
    settle(result) {
      if (settled) return;
      settled = true;
      resolve(result);
    },
  };
}

function runtimeTimers(options: CreateRecommendationsOptions) {
  return (
    options.timers ?? {
      setTimeout: (callback: () => void, delayMs: number) => setTimeout(callback, delayMs),
      clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    }
  );
}

async function waitFor(
  active: ActiveRequest,
  timeoutMs: number,
): Promise<WaitRecommendationResult> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1)
    throw new Error('timeoutMs must be a positive integer.');
  let handle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<WaitRecommendationResult>((resolve) => {
    handle = setTimeout(
      () =>
        resolve({
          status: 'timed_out',
          localDate: active.localDate,
          requestId: active.requestId,
        }),
      timeoutMs,
    );
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
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function readConfiguration(settings: Pick<Settings, 'readSettings'>) {
  const result = settings.readSettings();
  if (result.status === 'rejected') throw new Error(result.error.message);
  return result.settings.config;
}
