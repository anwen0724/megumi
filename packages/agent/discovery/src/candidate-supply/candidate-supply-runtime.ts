/*
 * Owns event-driven Candidate Supply gap rechecks, single-flight execution, backoff, and wake scheduling.
 */
import { randomUUID } from 'node:crypto';
import type { Api, Model } from '@megumi/ai';
import type {
  CandidateSupplyExecutionInput,
  ExecutionOutcome,
  StartCandidateSupplyExecutionResult,
} from '@megumi/execution';
import type { Observability, OperationCompletion } from '@megumi/observability';
import type { DiscoveryConfigurationStore } from '../configuration/discovery-configuration';
import type { DiscoveryRepository } from '../persistence/discovery-repository';
import type { SourceRegistry } from '../sources/source-registry';
import { hasCandidatePoolGap } from './candidate-pool';
import type { CandidatePoolSnapshot, CandidateSupplySettlement } from './candidate-supply';
import type {
  CandidateSupplyAttempts,
  CandidateSupplyAttemptSummary,
} from './candidate-supply-attempts';

const BACKOFF_MS = [5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000] as const;

export type CandidateSupplyTrigger =
  | 'startup'
  | 'resume'
  | 'interest_changed'
  | 'configuration_changed'
  | 'candidate_state_changed'
  | 'consumer_shortfall'
  | 'scheduled_recheck';

export interface CandidateSupplyRuntime {
  start(): Promise<void>;
  notify(trigger: CandidateSupplyTrigger): void;
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
  readonly proactiveTargetCount?: () => number;
  readonly consumerShortfalls?: () => {
    readonly daily?: number;
    readonly proactive?: number;
  };
  readonly observability?: Observability;
  readonly timers?: {
    set(delayMs: number, callback: () => void): unknown;
    clear(handle: unknown): void;
  };
  readonly onBackgroundError?: (error: unknown) => void;
  /** Notifies an independent consumer after Supply increases the available Pool. */
  readonly onPoolAvailable?: () => void;
}

export function createCandidateSupplyRuntime(
  options: CreateCandidateSupplyRuntimeOptions,
): CandidateSupplyRuntime {
  const timers = options.timers ?? nodeTimers();
  let stopped = false;
  let activeExecution = false;
  let rerunRequested = false;
  let timer: unknown;
  let running: Promise<void> | undefined;

  function notify(trigger: CandidateSupplyTrigger): void {
    if (stopped) return;
    if (timer !== undefined) {
      timers.clear(timer);
      timer = undefined;
    }
    if (activeExecution) {
      rerunRequested = true;
      return;
    }
    running = recheck(trigger).catch((error) => options.onBackgroundError?.(error));
  }

  async function recheck(trigger: CandidateSupplyTrigger): Promise<void> {
    if (stopped || activeExecution) return;
    const now = options.now();
    const snapshot = getSnapshot(options, now);
    if (!hasCandidatePoolGap(snapshot.gap)) {
      persistWakeState(options, 0, undefined, snapshot.nextRecheckAt, now);
      schedule(snapshot.nextRecheckAt);
      return;
    }
    const state = options.repository.readSupplyState();
    if (state?.retryAt && Date.parse(state.retryAt) > Date.parse(now)) {
      schedule(state.retryAt);
      return;
    }
    const settings = options.settings.read();
    const configuredSources = options.sourceRegistry.listSources().filter(({ descriptor }) => (
      settings.enabledSources.includes(descriptor.id)
    ));
    const readySources = configuredSources.filter(({ descriptor, availability }) => (
      availability.state === 'ready'
      && (!availability.retryAt || Date.parse(availability.retryAt) <= Date.parse(now))
      && (!options.repository.readSourceState(descriptor.id)?.retryAt
        || Date.parse(options.repository.readSourceState(descriptor.id)!.retryAt!) <= Date.parse(now))
    ));
    if (readySources.length === 0) {
      const nextSourceRetry = configuredSources
        .flatMap(({ descriptor, availability }) => [
          availability.retryAt,
          options.repository.readSourceState(descriptor.id)?.retryAt,
        ])
        .filter((value): value is string => Boolean(value))
        .sort()[0];
      persistWakeState(
        options,
        state?.consecutiveZeroYieldCount ?? 0,
        nextSourceRetry,
        nextSourceRetry,
        now,
        settlement(snapshot, 'no_available_source', now),
      );
      schedule(nextSourceRetry);
      return;
    }
    const model = await options.resolveModel();
    if (model.status === 'failed') {
      applyBackoff(
        options,
        snapshot,
        state?.consecutiveZeroYieldCount ?? 0,
        now,
        settlement(snapshot, 'agent_failed', now),
      );
      return;
    }

    const availableBefore = snapshot.counts.available;
    activeExecution = true;
    rerunRequested = false;
    let executionId: string | undefined;
    let attemptSummary: CandidateSupplyAttemptSummary | undefined;
    let outcome: ExecutionOutcome;
    try {
      outcome = await withTrace(options.observability, async () => {
        const started = await options.startExecution({
          kind: 'candidate_supply',
          requestId: `candidate-supply-request:${randomUUID()}`,
          trigger,
          model: model.model,
          accept: async ({ executionId: acceptedExecutionId }) => {
            executionId = acceptedExecutionId;
            try {
              options.attempts.start({
                executionId: acceptedExecutionId,
                startedAt: now,
                trigger,
                repository: options.repository,
                sourceRegistry: options.sourceRegistry,
                enabledSourceIds: configuredSources.map(({ descriptor }) => descriptor.id),
                initialCandidateIds: snapshot.pendingCandidates.map((candidate) => candidate.candidateId),
                getSnapshot: () => getSnapshot(options, options.now()),
                now: options.now,
              });
              return { status: 'accepted' };
            } catch (error) {
              return { status: 'rejected', reason: messageOf(error) };
            }
          },
          onSettled: () => undefined,
        });
        if (started.status === 'started' || started.status === 'already_started') {
          return started.completion;
        }
        if (started.status === 'failed') return { status: 'failed', failure: started.failure };
        return {
          status: 'failed',
          failure: {
            code: 'internal_error',
            message: messageOf(started.reason),
            retryable: true,
          },
        };
      });
    } finally {
      if (executionId) {
        attemptSummary = options.attempts.summarize(executionId);
        options.attempts.dispose(executionId);
      }
      activeExecution = false;
    }
    const after = getSnapshot(options, options.now());
    if (after.counts.available > availableBefore) {
      try {
        options.onPoolAvailable?.();
      } catch {
        // A consumer wake-up cannot alter Candidate Supply settlement.
      }
    }
    settleAttempt(
      options,
      after,
      availableBefore,
      outcome,
      options.now(),
      executionId,
      attemptSummary,
    );
    if (rerunRequested) {
      rerunRequested = false;
      notify('candidate_state_changed');
      return;
    }
    const settledState = options.repository.readSupplyState();
    schedule(hasCandidatePoolGap(after.gap) ? settledState?.retryAt : after.nextRecheckAt);
  }

  function schedule(at: string | undefined): void {
    if (stopped || !at) return;
    if (timer !== undefined) timers.clear(timer);
    const delay = Math.max(0, Date.parse(at) - Date.parse(options.now()));
    timer = timers.set(delay, () => {
      timer = undefined;
      notify('scheduled_recheck');
    });
  }

  return {
    async start() {
      stopped = false;
      options.repository.interruptRunningQueries(options.now());
      notify('startup');
    },
    notify,
    async shutdown() {
      stopped = true;
      if (timer !== undefined) timers.clear(timer);
      timer = undefined;
      await running;
    },
  };
}

function settleAttempt(
  options: CreateCandidateSupplyRuntimeOptions,
  snapshot: CandidatePoolSnapshot,
  availableBefore: number,
  outcome: ExecutionOutcome,
  now: string,
  executionId: string | undefined,
  summary: CandidateSupplyAttemptSummary | undefined,
): void {
  const produced = snapshot.counts.available > availableBefore;
  const current = options.repository.readSupplyState();
  if (!hasCandidatePoolGap(snapshot.gap)) {
    persistWakeState(
      options,
      0,
      undefined,
      snapshot.nextRecheckAt,
      now,
      settlement(snapshot, 'fulfilled', now, executionId),
    );
    return;
  }
  const consecutive = produced ? 0 : (current?.consecutiveZeroYieldCount ?? 0) + 1;
  const backoffStep = Math.max(1, consecutive);
  const retryAt = hasCandidatePoolGap(snapshot.gap)
    ? new Date(Date.parse(now) + BACKOFF_MS[Math.min(backoffStep, BACKOFF_MS.length) - 1]!).toISOString()
    : snapshot.nextRecheckAt;
  persistWakeState(
    options,
    consecutive,
    hasCandidatePoolGap(snapshot.gap) ? retryAt : undefined,
    retryAt,
    now,
    settlement(snapshot, settlementReason(snapshot, outcome, summary), now, executionId),
  );
}

function applyBackoff(
  options: CreateCandidateSupplyRuntimeOptions,
  snapshot: CandidatePoolSnapshot,
  previous: number,
  now: string,
  lastSettlement: CandidateSupplySettlement,
): void {
  const consecutive = previous + 1;
  const retryAt = new Date(
    Date.parse(now) + BACKOFF_MS[Math.min(consecutive, BACKOFF_MS.length) - 1]!,
  ).toISOString();
  persistWakeState(options, consecutive, retryAt, retryAt, now, lastSettlement);
}

function persistWakeState(
  options: CreateCandidateSupplyRuntimeOptions,
  consecutiveZeroYieldCount: number,
  retryAt: string | undefined,
  nextRecheckAt: string | undefined,
  now: string,
  lastSettlement?: CandidateSupplySettlement,
): void {
  const current = options.repository.readSupplyState();
  const retainedSettlement = lastSettlement ?? current?.lastSettlement;
  options.repository.writeSupplyState({
    consecutiveZeroYieldCount,
    ...(retryAt ? { retryAt } : {}),
    ...(nextRecheckAt ? { nextRecheckAt } : {}),
    ...(retainedSettlement ? { lastSettlement: retainedSettlement } : {}),
    updatedAt: now,
  });
}

function settlementReason(
  snapshot: CandidatePoolSnapshot,
  outcome: ExecutionOutcome,
  summary: CandidateSupplyAttemptSummary | undefined,
): CandidateSupplySettlement['reason'] {
  if (!hasCandidatePoolGap(snapshot.gap)) return 'fulfilled';
  if (outcome.status === 'cancelled') return 'cancelled';
  if (outcome.status === 'failed') return 'agent_failed';
  if (summary && (
    summary.searchesStarted >= 12
    || summary.readsStarted >= 40
    || summary.rawResultsReceived >= 200
  )) return 'budget_exhausted';
  if (summary && summary.searchesSucceeded === 0 && summary.sourceFailures > 0) {
    return 'no_available_source';
  }
  if (summary && summary.searchesSucceeded >= 2 && summary.admittedCandidates === 0) {
    return 'zero_yield';
  }
  return 'agent_failed';
}

function settlement(
  snapshot: CandidatePoolSnapshot,
  reason: CandidateSupplySettlement['reason'],
  settledAt: string,
  executionId?: string,
): CandidateSupplySettlement {
  return {
    ...(executionId ? { executionId } : {}),
    reason,
    remainingGap: {
      totalShortfall: snapshot.gap.totalShortfall,
      uncoveredInterestIds: [...snapshot.gap.uncoveredInterestIds],
      consumerShortfalls: snapshot.gap.consumerShortfalls.map((shortfall) => ({ ...shortfall })),
    },
    settledAt,
  };
}

function getSnapshot(options: CreateCandidateSupplyRuntimeOptions, now: string): CandidatePoolSnapshot {
  const settings = options.settings.read();
  const consumerShortfalls = options.consumerShortfalls?.();
  return options.repository.getPoolSnapshot({
    now,
    dailyTargetCount: settings.dailyTargetCount,
    proactiveTargetCount: options.proactiveTargetCount?.() ?? 0,
    ...(consumerShortfalls?.daily !== undefined ? { dailyShortfall: consumerShortfalls.daily } : {}),
    ...(consumerShortfalls?.proactive !== undefined
      ? { proactiveShortfall: consumerShortfalls.proactive }
      : {}),
  });
}

async function withTrace(
  observability: Observability | undefined,
  operation: () => Promise<ExecutionOutcome>,
): Promise<ExecutionOutcome> {
  let promise: Promise<ExecutionOutcome> | undefined;
  const runOnce = () => (promise ??= operation());
  if (!observability) return runOnce();
  try {
    return await observability.withTrace({
      kind: 'candidate_supply',
      classifyResult: classifyExecutionOutcome,
      correlation: {},
    }, runOnce);
  } catch {
    return runOnce();
  }
}

function classifyExecutionOutcome(outcome: ExecutionOutcome): OperationCompletion {
  if (outcome.status === 'completed') return { outcome: { status: 'ok' } };
  if (outcome.status === 'cancelled') return { outcome: { status: 'cancelled' } };
  return {
    outcome: {
      status: 'error',
      code: outcome.failure.code,
      message: outcome.failure.message,
      retryable: outcome.failure.retryable,
    },
  };
}

function nodeTimers() {
  return {
    set: (delayMs: number, callback: () => void) => setTimeout(callback, delayMs),
    clear: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Candidate Supply operation failed.';
}
