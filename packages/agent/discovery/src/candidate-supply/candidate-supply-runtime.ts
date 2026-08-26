/*
 * Owns event-driven Candidate Supply gap rechecks, single-flight execution, backoff, and wake scheduling.
 */
import { randomUUID } from 'node:crypto';
import type { Api, Model } from '@megumi/ai';
import type { CandidateSupplyContextMaterial } from '@megumi/context';
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
import type { CandidatePoolSnapshot } from './candidate-supply';
import type { CandidateSupplyAttempts } from './candidate-supply-attempts';

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
  readonly observability?: Observability;
  readonly timers?: {
    set(delayMs: number, callback: () => void): unknown;
    clear(handle: unknown): void;
  };
  readonly onBackgroundError?: (error: unknown) => void;
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
    const enabledSources = options.sourceRegistry.listSources().filter(({ descriptor, availability }) => (
      settings.enabledSources.includes(descriptor.id)
      && availability.state === 'ready'
      && (!availability.retryAt || Date.parse(availability.retryAt) <= Date.parse(now))
      && (!options.repository.readSourceState(descriptor.id)?.retryAt
        || Date.parse(options.repository.readSourceState(descriptor.id)!.retryAt!) <= Date.parse(now))
    ));
    if (enabledSources.length === 0) {
      const nextSourceRetry = options.sourceRegistry.listSources()
        .filter(({ descriptor }) => settings.enabledSources.includes(descriptor.id))
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
      );
      schedule(nextSourceRetry);
      return;
    }
    const model = await options.resolveModel();
    if (model.status === 'failed') {
      applyBackoff(options, snapshot, state?.consecutiveZeroYieldCount ?? 0, now);
      return;
    }

    const availableBefore = snapshot.counts.available;
    const material = buildMaterial(options, snapshot, enabledSources, now);
    activeExecution = true;
    rerunRequested = false;
    let executionId: string | undefined;
    let outcome: ExecutionOutcome = {
      status: 'failed',
      failure: { code: 'internal_error', message: 'Candidate Supply did not start.', retryable: true },
    };
    try {
      await withTrace(options.observability, material, async () => {
        const started = await options.startExecution({
          kind: 'candidate_supply',
          requestId: `candidate-supply-request:${randomUUID()}`,
          model: model.model,
          material,
          accept: async ({ executionId: acceptedExecutionId }) => {
            executionId = acceptedExecutionId;
            try {
              options.attempts.start({
                executionId: acceptedExecutionId,
                repository: options.repository,
                sourceRegistry: options.sourceRegistry,
                enabledSourceIds: enabledSources.map(({ descriptor }) => descriptor.id),
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
          outcome = await started.completion;
        } else if (started.status === 'failed') {
          outcome = { status: 'failed', failure: started.failure };
        }
      });
    } finally {
      if (executionId) options.attempts.dispose(executionId);
      activeExecution = false;
    }
    const after = getSnapshot(options, options.now());
    settleAttempt(options, after, availableBefore, outcome, options.now());
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

function buildMaterial(
  options: CreateCandidateSupplyRuntimeOptions,
  snapshot: CandidatePoolSnapshot,
  sources: ReturnType<SourceRegistry['listSources']>,
  now: string,
): CandidateSupplyContextMaterial {
  const activeInterests = options.repository.listInterests().filter((interest) => interest.status === 'active');
  return {
    pool: {
      counts: snapshot.counts,
      lowWatermark: snapshot.thresholds.lowWatermark,
      target: snapshot.thresholds.target,
      hardLimit: snapshot.thresholds.hardLimit,
      totalShortfall: snapshot.gap.totalShortfall,
      uncoveredInterestIds: snapshot.gap.uncoveredInterestIds,
      consumerShortfalls: snapshot.gap.consumerShortfalls,
    },
    interests: activeInterests.map(({ interestId, description }) => ({ interestId, description })),
    negativeConstraints: options.repository.listNegativeConstraints(),
    sources: sources.map(({ descriptor, availability }) => ({
      id: descriptor.id,
      name: descriptor.name,
      access: descriptor.access,
      supportedModes: descriptor.supportedModes,
      supportsRead: descriptor.supportsRead,
      availability: availability.state,
      ...((latestTimestamp(
        availability.retryAt,
        options.repository.readSourceState(descriptor.id)?.retryAt,
      )) ? {
          retryAt: latestTimestamp(
            availability.retryAt,
            options.repository.readSourceState(descriptor.id)?.retryAt,
          ),
        } : {}),
    })),
    recentQueryOutcomes: options.repository.listRecentQueryOutcomes({ now, withinDays: 30, limit: 50 }),
    pendingCandidates: snapshot.pendingCandidates.map((candidate) => ({
      candidate,
      potentialDuplicates: options.repository.listPotentialDuplicates(candidate.candidateId, 10),
    })),
    budget: { searchesRemaining: 12, readsRemaining: 40, rawResultsRemaining: 200 },
  };
}

function settleAttempt(
  options: CreateCandidateSupplyRuntimeOptions,
  snapshot: CandidatePoolSnapshot,
  availableBefore: number,
  outcome: ExecutionOutcome,
  now: string,
): void {
  const produced = snapshot.counts.available > availableBefore;
  const current = options.repository.readSupplyState();
  if (produced && !hasCandidatePoolGap(snapshot.gap)) {
    persistWakeState(options, 0, undefined, snapshot.nextRecheckAt, now);
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
  );
  void outcome;
}

function applyBackoff(
  options: CreateCandidateSupplyRuntimeOptions,
  snapshot: CandidatePoolSnapshot,
  previous: number,
  now: string,
): void {
  const consecutive = previous + 1;
  const retryAt = new Date(
    Date.parse(now) + BACKOFF_MS[Math.min(consecutive, BACKOFF_MS.length) - 1]!,
  ).toISOString();
  persistWakeState(options, consecutive, retryAt, retryAt, now);
}

function persistWakeState(
  options: CreateCandidateSupplyRuntimeOptions,
  consecutiveZeroYieldCount: number,
  retryAt: string | undefined,
  nextRecheckAt: string | undefined,
  now: string,
): void {
  options.repository.writeSupplyState({
    consecutiveZeroYieldCount,
    ...(retryAt ? { retryAt } : {}),
    ...(nextRecheckAt ? { nextRecheckAt } : {}),
    updatedAt: now,
  });
}

function getSnapshot(options: CreateCandidateSupplyRuntimeOptions, now: string): CandidatePoolSnapshot {
  const settings = options.settings.read();
  return options.repository.getPoolSnapshot({
    now,
    dailyTargetCount: settings.dailyTargetCount,
    proactiveTargetCount: options.proactiveTargetCount?.() ?? 0,
  });
}

async function withTrace(
  observability: Observability | undefined,
  material: CandidateSupplyContextMaterial,
  operation: () => Promise<void>,
): Promise<void> {
  let promise: Promise<void> | undefined;
  const runOnce = () => (promise ??= operation());
  if (!observability) return runOnce();
  try {
    return await observability.withTrace({
      kind: 'candidate_supply',
      classifyResult: (): OperationCompletion => ({ outcome: { status: 'ok' } }),
      correlation: {},
    }, async () => {
      try {
        observability.recordContent({ kind: 'context.resolved', value: material });
      } catch {
        // Trace capture is isolated from Supply execution.
      }
      return runOnce();
    });
  } catch {
    return runOnce();
  }
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

function latestTimestamp(...values: readonly (string | undefined)[]): string | undefined {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1);
}
