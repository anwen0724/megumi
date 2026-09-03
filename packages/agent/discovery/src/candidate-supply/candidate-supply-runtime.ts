/*
 * Owns Candidate Supply triggers, single-execution gating, scheduling, and final settlement.
 */
import type { Api, Model } from '@megumi/ai';
import type {
  CandidateSupplyExecutionInput,
  StartCandidateSupplyExecutionResult,
} from '@megumi/execution';
import type { Observability, OperationCompletion } from '@megumi/observability';
import type { DiscoveryConfigurationStore } from '../configuration/discovery-configuration';
import type { DiscoveryRepository } from '../persistence/discovery-repository';
import type { SourceRegistry } from '../sources/source-registry';
import type { CandidateSupplyAttempts } from './candidate-supply-attempts';
import {
  type CandidatePoolSnapshot,
  type CandidateSupplyResult,
  type CandidateSupplyTrigger,
} from './candidate-supply';
import { candidatePoolSettings } from './candidate-pool';

export interface CandidateSupplyRuntime {
  start(options?: { readonly automaticTriggers?: boolean }): Promise<void>;
  requestCheck(trigger: CandidateSupplyTrigger): Promise<CandidateSupplyResult>;
  shutdown(): Promise<void>;
}

export interface CreateCandidateSupplyRuntimeOptions {
  readonly repository: DiscoveryRepository;
  readonly attempts: CandidateSupplyAttempts;
  readonly sourceRegistry: SourceRegistry;
  readonly settings: DiscoveryConfigurationStore;
  readonly startExecution: <TRejected>(
    request: CandidateSupplyExecutionInput<TRejected>,
  ) => Promise<StartCandidateSupplyExecutionResult<TRejected>>;
  readonly resolveModel: () => Promise<
    | { readonly status: 'ok'; readonly model: Model<Api> }
    | { readonly status: 'failed'; readonly code: string; readonly message: string }
  >;
  readonly now: () => string;
  readonly ids: { createRequestId(): string };
  readonly observability?: Observability;
  readonly timers?: {
    set(delayMs: number, callback: () => void): unknown;
    clear(handle: unknown): void;
  };
  readonly onBackgroundError?: (error: unknown) => void;
}

/** Creates the independent Candidate Supply background owner. */
export function createCandidateSupplyRuntime(
  options: CreateCandidateSupplyRuntimeOptions,
): CandidateSupplyRuntime {
  const timers = options.timers ?? nodeTimers();
  let activeCompletion: Promise<CandidateSupplyResult> | undefined;
  let stopped = false;
  let automaticTriggers = false;
  let timer: unknown;

  function requestCheck(trigger: CandidateSupplyTrigger): Promise<CandidateSupplyResult> {
    const requestId = options.ids.createRequestId();
    const requestedAt = parseTimestamp(options.now());
    if (activeCompletion) {
      return Promise.resolve(notNeeded(
        requestId,
        trigger,
        requestedAt,
        options.now(),
        'supply_in_progress',
      ));
    }
    let completion: Promise<CandidateSupplyResult>;
    completion = executeSupply(options, requestId, trigger, requestedAt).finally(() => {
      if (activeCompletion === completion) activeCompletion = undefined;
      schedule();
    });
    activeCompletion = completion;
    return completion;
  }

  function schedule(): void {
    if (stopped || !automaticTriggers) return;
    if (timer !== undefined) timers.clear(timer);
    let intervalMinutes: number;
    try {
      intervalMinutes = positiveInteger(
        options.settings.read().candidateSupplyCheckIntervalMinutes,
        'candidateSupplyCheckIntervalMinutes',
      );
    } catch (error) {
      reportBackgroundError(options, error);
      return;
    }
    timer = timers.set(intervalMinutes * 60_000, () => {
      timer = undefined;
      void requestCheck('scheduled').catch((error) => reportBackgroundError(options, error));
    });
  }

  return {
    async start(startOptions = {}) {
      stopped = false;
      automaticTriggers = startOptions.automaticTriggers ?? true;
      if (automaticTriggers) {
        void requestCheck('startup').catch((error) => reportBackgroundError(options, error));
      }
    },
    requestCheck,
    async shutdown() {
      stopped = true;
      automaticTriggers = false;
      if (timer !== undefined) timers.clear(timer);
      timer = undefined;
      await activeCompletion;
    },
  };
}

async function executeSupply(
  options: CreateCandidateSupplyRuntimeOptions,
  requestId: string,
  trigger: CandidateSupplyTrigger,
  requestedAt: string,
): Promise<CandidateSupplyResult> {
  try {
    return await withTrace(options.observability, requestId, () => runCheck(
      options,
      requestId,
      trigger,
      requestedAt,
    ));
  } catch (error) {
    return {
      ...baseResult(requestId, trigger, requestedAt, options.now(), 0, 0),
      status: 'failed',
      failure: {
        code: 'candidate_supply_failed',
        message: messageOf(error),
        retryable: true,
      },
    };
  }
}

async function runCheck(
  options: CreateCandidateSupplyRuntimeOptions,
  requestId: string,
  trigger: CandidateSupplyTrigger,
  requestedAt: string,
): Promise<CandidateSupplyResult> {
  const configuration = options.settings.read();
  const poolSettings = candidatePoolSettings({
    minimumCount: configuration.candidatePoolMinimumCount,
    maximumCount: configuration.candidatePoolMaximumCount,
    candidateValidityDays: configuration.candidateValidityDays,
    candidateContentExcerptMaxCharacters: configuration.candidateContentExcerptMaxCharacters,
  });
  const activeInterests = options.repository.listNonDeletedInterests()
    .filter(({ status }) => status === 'active');
  if (activeInterests.length === 0) {
    return notNeeded(requestId, trigger, requestedAt, options.now(), 'no_active_interest');
  }
  const before = options.repository.readCandidatePoolSnapshot(poolSettings);
  if (before.minimumShortfall === 0) {
    return notNeeded(requestId, trigger, requestedAt, options.now(), 'no_gap');
  }
  const readySourceIds = readySources(options.sourceRegistry, configuration.enabledSources);
  if (readySourceIds.length === 0) {
    return {
      ...baseResult(requestId, trigger, requestedAt, options.now(), 0, 0),
      status: 'unfulfilled',
      availableCount: before.availableCount,
      remainingReplenishmentCount: before.targetShortfall,
      reason: 'no_available_source',
    };
  }
  const resolvedModel = await options.resolveModel();
  if (resolvedModel.status === 'failed') {
    return {
      ...baseResult(requestId, trigger, requestedAt, options.now(), 0, 0),
      status: 'failed',
      availableCount: before.availableCount,
      remainingReplenishmentCount: before.targetShortfall,
      failure: {
        code: 'model_unavailable',
        message: resolvedModel.message,
        retryable: true,
      },
    };
  }

  let executionId: string | undefined;
  const started = await options.startExecution({
    kind: 'candidate_supply',
    requestId,
    trigger,
    model: resolvedModel.model,
    accept: async ({ executionId: acceptedExecutionId }) => {
      try {
        options.attempts.start({
          executionId: acceptedExecutionId,
          startedAt: options.now(),
          trigger,
          repository: options.repository,
          sourceRegistry: options.sourceRegistry,
          enabledSourceIds: readySourceIds,
          settings: poolSettings,
          now: options.now,
        });
        executionId = acceptedExecutionId;
        return { status: 'accepted' };
      } catch (error) {
        return { status: 'rejected', reason: messageOf(error) };
      }
    },
    onSettled: () => undefined,
  });
  if (started.status === 'failed') {
    return failureResult(
      requestId,
      trigger,
      requestedAt,
      options.now(),
      before,
      started.failure,
    );
  }
  if (started.status === 'rejected') {
    return failureResult(requestId, trigger, requestedAt, options.now(), before, {
      code: 'candidate_supply_execution_rejected',
      message: messageOf(started.reason),
      retryable: true,
    });
  }
  executionId ??= started.execution.executionId;
  const outcome = await started.completion;
  const summary = options.attempts.summarize(executionId);
  options.attempts.dispose(executionId);
  const after = safeSnapshot(options.repository, poolSettings);
  const additions = countAdditions(before, after, summary);
  const base = baseResult(
    requestId,
    trigger,
    requestedAt,
    options.now(),
    additions.candidates,
    additions.matches,
  );

  if (!after) {
    return {
      ...base,
      status: 'failed',
      executionId,
      failure: {
        code: 'candidate_pool_unavailable',
        message: 'Candidate Pool could not be read after Agent Execution.',
        retryable: true,
      },
    };
  }
  if (outcome.status === 'failed') {
    return {
      ...base,
      status: 'failed',
      executionId,
      availableCount: after.availableCount,
      remainingReplenishmentCount: after.targetShortfall,
      failure: outcome.failure,
    };
  }
  if (outcome.status === 'cancelled') {
    return {
      ...base,
      status: 'cancelled',
      executionId,
      availableCount: after.availableCount,
      remainingReplenishmentCount: after.targetShortfall,
    };
  }
  if (after.targetShortfall === 0) {
    return {
      ...base,
      status: 'fulfilled',
      executionId,
      availableCount: after.availableCount,
      remainingReplenishmentCount: 0,
    };
  }
  if (additions.candidates > 0 || additions.matches > 0) {
    return {
      ...base,
      status: 'partially_fulfilled',
      executionId,
      availableCount: after.availableCount,
      remainingReplenishmentCount: after.targetShortfall,
      reason: summary?.searchResultCount ? 'no_more_result' : 'sources_exhausted',
    };
  }
  return {
    ...base,
    status: 'unfulfilled',
    executionId,
    availableCount: after.availableCount,
    remainingReplenishmentCount: after.targetShortfall,
    reason: summary?.searchResultCount ? 'no_related_content' : 'no_search_result',
  };
}

function readySources(registry: SourceRegistry, enabledSourceIds: readonly string[]): readonly string[] {
  const enabled = new Set(enabledSourceIds);
  return registry.listDescriptors().flatMap((descriptor) => {
    if (!enabled.has(descriptor.id)) return [];
    try {
      return registry.get(descriptor.id)?.getAvailability().state === 'ready'
        ? [descriptor.id]
        : [];
    } catch {
      return [];
    }
  });
}

function countAdditions(
  before: CandidatePoolSnapshot,
  after: CandidatePoolSnapshot | undefined,
  summary: ReturnType<CandidateSupplyAttempts['summarize']>,
): { readonly candidates: number; readonly matches: number } {
  const beforeCandidateIds = new Set(before.candidates.map(({ candidate }) => candidate.id));
  const beforeMatchIds = new Set(before.candidates.flatMap(({ interestMatches }) => (
    interestMatches.map(({ id }) => id)
  )));
  const snapshotCandidates = after
    ? after.candidates.filter(({ candidate }) => !beforeCandidateIds.has(candidate.id)).length
    : 0;
  const snapshotMatches = after
    ? after.candidates.flatMap(({ interestMatches }) => interestMatches)
        .filter(({ id }) => !beforeMatchIds.has(id)).length
    : 0;
  return {
    candidates: Math.max(snapshotCandidates, summary?.addedCandidateCount ?? 0),
    matches: Math.max(snapshotMatches, summary?.addedInterestMatchCount ?? 0),
  };
}

function safeSnapshot(
  repository: DiscoveryRepository,
  settings: ReturnType<typeof candidatePoolSettings>,
): CandidatePoolSnapshot | undefined {
  try {
    return repository.readCandidatePoolSnapshot(settings);
  } catch {
    return undefined;
  }
}

function failureResult(
  requestId: string,
  trigger: CandidateSupplyTrigger,
  requestedAt: string,
  completedAt: string,
  snapshot: CandidatePoolSnapshot,
  failure: { readonly code: string; readonly message: string; readonly retryable: boolean },
): CandidateSupplyResult {
  return {
    ...baseResult(requestId, trigger, requestedAt, completedAt, 0, 0),
    status: 'failed',
    availableCount: snapshot.availableCount,
    remainingReplenishmentCount: snapshot.targetShortfall,
    failure,
  };
}

function notNeeded(
  requestId: string,
  trigger: CandidateSupplyTrigger,
  requestedAt: string,
  completedAt: string,
  reason: 'no_gap' | 'no_active_interest' | 'supply_in_progress',
): CandidateSupplyResult {
  return {
    ...baseResult(requestId, trigger, requestedAt, completedAt, 0, 0),
    status: 'not_needed',
    reason,
  };
}

function baseResult(
  requestId: string,
  trigger: CandidateSupplyTrigger,
  requestedAt: string,
  completedAt: string,
  addedCandidateCount: number,
  addedInterestMatchCount: number,
) {
  return {
    requestId,
    trigger,
    requestedAt,
    completedAt: parseTimestamp(completedAt),
    addedCandidateCount,
    addedInterestMatchCount,
  };
}

async function withTrace(
  observability: Observability | undefined,
  requestId: string,
  operation: () => Promise<CandidateSupplyResult>,
): Promise<CandidateSupplyResult> {
  let pending: Promise<CandidateSupplyResult> | undefined;
  const runOnce = () => (pending ??= operation());
  if (!observability) return runOnce();
  try {
    return await observability.withTrace({
      kind: 'candidate_supply',
      correlation: { requestId },
      classifyResult: classifyResult,
    }, runOnce);
  } catch {
    return runOnce();
  }
}

function classifyResult(result: CandidateSupplyResult): OperationCompletion {
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
  if (result.status === 'cancelled') return { outcome: { status: 'cancelled' } };
  return { outcome: { status: 'ok', code: result.status } };
}

function nodeTimers() {
  return {
    set: (delayMs: number, callback: () => void) => setTimeout(callback, delayMs),
    clear: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}

function reportBackgroundError(options: CreateCandidateSupplyRuntimeOptions, error: unknown): void {
  try {
    options.onBackgroundError?.(error);
  } catch {
    // The observer is the terminal boundary for background diagnostics.
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return value;
}

function parseTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error('Clock returned an invalid timestamp.');
  return new Date(timestamp).toISOString();
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Candidate Supply operation failed.';
}

export type { CandidateSupplyTrigger } from './candidate-supply';
