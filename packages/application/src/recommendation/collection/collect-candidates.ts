/* Owns Candidate collection admission, cancellation and settlement of committed results. */
import type { Agent } from '@megumi/agent';
import type { Observability, OperationCompletion } from '../../observability/index';
import type { Settings } from '../../settings/settings-store';
import type { CandidatePoolSnapshot, CandidateSupplyResult, CandidateSupplyTrigger } from '../candidates/candidate-pool';
import { candidatePoolSettings } from '../candidates/candidate-pool';
import type { DiscoveryConfigurationStore } from '../recommendation-settings';
import type { DiscoveryRepository } from '../recommendation-storage';
import type { SourceRegistry } from '../sources/source-catalog';
import { type CandidateSupplyAttemptSummary } from './agent-tools';
import { createCollectionContext } from './prepare-context';
import { prepareCollectionRun, type CollectionPreparation } from './prepare-run';

export interface Candidates {
  /** Persists first-use consent before asynchronously checking supply conditions. */
  confirm(): Promise<{ readonly status: 'confirmed' | 'already_confirmed'; }>;
  /** Returns process-local progress without starting work. */
  getStatus(): CandidateSupplyStatus;
  start(options?: { readonly automaticTriggers?: boolean; }): Promise<void>;
  ensureSupply(trigger: CandidateSupplyTrigger): Promise<CandidateSupplyResult>;
  updateSchedule(): void;
  shutdown(): Promise<void>;
}

export type CandidateSupplyStatus =
  | { readonly status: 'idle' | 'running'; }
  | {
    readonly status: 'failed';
    readonly failure: Extract<CandidateSupplyResult, { status: 'failed'; }>['failure'];
  };

export interface CreateCandidatesOptions {
  readonly repository: DiscoveryRepository;
  readonly sourceRegistry: SourceRegistry;
  readonly settings: DiscoveryConfigurationStore;
  readonly agent: Agent;
  readonly preparation: CollectionPreparation;
  readonly now: () => string;
  readonly ids: { createRequestId(): string; };
  readonly observability?: Observability;
  readonly timers?: {
    set(delayMs: number, callback: () => void): unknown;
    clear(handle: unknown): void;
  };
  readonly onBackgroundError?: (error: unknown) => void;
}

/** Creates the independent Candidate Supply background owner. */
export function createCandidates(options: CreateCandidatesOptions): Candidates {
  const timers = options.timers ?? nodeTimers();
  let activeCompletion: Promise<CandidateSupplyResult> | undefined;
  let stopped = false;
  let activeController: AbortController | undefined;
  let automaticTriggers = false;
  let timer: unknown;
  let confirmation: Promise<{ readonly status: 'confirmed' | 'already_confirmed'; }> | undefined;
  let lastResult: CandidateSupplyResult | undefined;

  function ensureSupply(trigger: CandidateSupplyTrigger): Promise<CandidateSupplyResult> {
    if (stopped) return Promise.reject(new Error('Candidate Supply is shutting down.'));
    const requestId = options.ids.createRequestId();
    const requestedAt = parseTimestamp(options.now());
    if (activeCompletion) {
      return Promise.resolve(
        notNeeded(requestId, trigger, requestedAt, options.now(), 'supply_in_progress'),
      );
    }
    const controller = new AbortController();
    activeController = controller;
    let completion: Promise<CandidateSupplyResult>;
    completion = executeSupply(options, requestId, trigger, requestedAt, controller.signal)
      .then((result) => {
        lastResult = result;
        return result;
      })
      .finally(() => {
        if (activeCompletion === completion) { activeCompletion = undefined; activeController = undefined; }
        try {
          schedule();
        } catch (error) {
          reportBackgroundError(options, error);
        }
      });
    activeCompletion = completion;
    return completion;
  }

  function schedule(): void {
    if (stopped || !automaticTriggers) return;
    if (timer !== undefined) timers.clear(timer);
    const intervalMinutes = positiveInteger(
      readConfiguration(options.settings).discovery.candidateSupplyCheckIntervalMinutes,
      'candidateSupplyCheckIntervalMinutes',
    );
    timer = timers.set(intervalMinutes * 60_000, () => {
      timer = undefined;
      void ensureSupply('scheduled').catch((error) => reportBackgroundError(options, error));
    });
  }

  return {
    confirm() {
      if (stopped) return Promise.reject(new Error('Candidate Supply is shutting down.'));
      if (confirmation) return confirmation;
      confirmation = (async () => {
        const snapshot = options.settings.readSettings();
        if (snapshot.status === 'rejected') throw new Error(snapshot.error.message);
        const settings = snapshot.settings.config.discovery;
        if (settings.candidateSupplyConfirmed) return { status: 'already_confirmed' as const };
        const pendingBeforeConfirmation = activeCompletion;
        const saved = options.settings.updateSettings({
          patch: { discovery: { candidateSupplyConfirmed: true } },
          expectedRevision: snapshot.settings.revision,
        });
        if (saved.status === 'rejected') throw new Error(saved.error.message);
        if (stopped) throw new Error('Candidate Supply is shutting down.');
        // Consent and business completion are distinct: never keep the UI waiting for the Agent.
        // A pre-consent check may still be settling, so join it before requesting the confirmed check.
        void (async () => {
          if (pendingBeforeConfirmation) await pendingBeforeConfirmation;
          if (!stopped) await ensureSupply('supply_conditions_changed');
        })().catch((error) => reportBackgroundError(options, error));
        return { status: 'confirmed' as const };
      })().finally(() => {
        confirmation = undefined;
      });
      return confirmation;
    },
    getStatus() {
      if (activeCompletion) return { status: 'running' };
      if (lastResult?.status === 'failed') return { status: 'failed', failure: lastResult.failure };
      return { status: 'idle' };
    },
    async start(startOptions = {}) {
      stopped = false;
      automaticTriggers = startOptions.automaticTriggers ?? true;
      if (automaticTriggers) {
        void ensureSupply('startup').catch((error) => reportBackgroundError(options, error));
      }
    },
    ensureSupply,
    updateSchedule: schedule,
    async shutdown() {
      stopped = true;
      automaticTriggers = false;
      if (timer !== undefined) timers.clear(timer);
      timer = undefined;
      activeController?.abort();
      await activeCompletion;
    },
  };
}

async function executeSupply(
  options: CreateCandidatesOptions,
  requestId: string,
  trigger: CandidateSupplyTrigger,
  requestedAt: string,
  signal: AbortSignal,
): Promise<CandidateSupplyResult> {
  try {
    return await withTrace(options.observability, requestId, () =>
      runCheck(options, requestId, trigger, requestedAt, signal),
    );
  } catch (error) {
    return {
      ...baseResult(requestId, trigger, requestedAt, options.now(), 0, 0),
      ...(signal.aborted ? { status: 'cancelled' as const } : {
        status: 'failed' as const, failure: {
          code: 'candidate_supply_failed',
          message: messageOf(error),
          retryable: true,
        }
      }),
    };
  }
}

async function runCheck(
  options: CreateCandidatesOptions,
  requestId: string,
  trigger: CandidateSupplyTrigger,
  requestedAt: string,
  signal: AbortSignal,
): Promise<CandidateSupplyResult> {
  const configuration = readConfiguration(options.settings).discovery;
  const poolSettings = candidatePoolSettings({
    minimumCount: configuration.candidatePoolMinimumCount,
    maximumCount: configuration.candidatePoolMaximumCount,
    candidateValidityDays: configuration.candidateValidityDays,
    candidateContentExcerptMaxCharacters: configuration.candidateContentExcerptMaxCharacters,
  });
  const activeInterests = options.repository
    .listNonDeletedInterests()
    .filter(({ status }) => status === 'active');
  if (activeInterests.length === 0) {
    return notNeeded(requestId, trigger, requestedAt, options.now(), 'no_active_interest');
  }
  if (!configuration.candidateSupplyConfirmed) {
    return notNeeded(requestId, trigger, requestedAt, options.now(), 'confirmation_required');
  }
  const before = options.repository.getCandidatePoolSnapshot(poolSettings);
  if (before.minimumShortfall === 0) {
    return notNeeded(requestId, trigger, requestedAt, options.now(), 'no_gap');
  }
  const readySourceIds = readySources(
    options.sourceRegistry,
    configuration.enabledSources,
    options.observability,
  );
  if (readySourceIds.length === 0) {
    return {
      ...baseResult(requestId, trigger, requestedAt, options.now(), 0, 0),
      status: 'unfulfilled',
      availableCount: before.availableCount,
      remainingReplenishmentCount: before.targetShortfall,
      reason: 'no_available_source',
    };
  }
  const prepared = await prepareCollectionRun({
    modelSelection: configuration.candidateSupplyModel, signal,
    collection: {
      observability: options.observability,
      startedAt: options.now(),
      trigger,
      repository: options.repository,
      sourceRegistry: options.sourceRegistry,
      enabledSourceIds: readySourceIds,
      settings: poolSettings,
      twitterBudget: configuration.twitterBudget,
      now: options.now,
    },
  }, options.preparation);
  if (!prepared) return failureResult(requestId, trigger, requestedAt, options.now(), before, {
    code: 'model_unavailable', message: 'Candidate collection model is unavailable.', retryable: true,
  });
  const { config, collection } = prepared;
  signal.throwIfAborted();
  const run = options.agent.startAgent({
    config, signal,
    input: { role: 'user', content: 'Generate the candidate pool.', timestamp: Date.parse(requestedAt) },
    context: createCollectionContext({
      collection, repository: options.repository, sources: options.sourceRegistry,
      instructionDocuments: options.preparation.instructionDocuments
    }),
  });
  const executionId = run.runId;
  const outcome = await run.completion;
  const summary = collection.summarize();
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
      failure: outcome.error,
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


/** Captures why each registered Source enters or is excluded from this execution's context. */
function readySources(
  registry: SourceRegistry,
  enabledSourceIds: readonly string[],
  observability: Observability | undefined,
): readonly string[] {
  const enabled = new Set(enabledSourceIds);
  const selection = registry.listDescriptors().map(({ id }) => {
    const base = { sourceId: id, enabled: enabled.has(id) };
    if (!base.enabled) return { ...base, selected: false, reason: 'disabled' };
    try {
      const availability = registry.get(id)?.getAvailability();
      return {
        ...base,
        selected: availability?.state === 'ready',
        reason: availability?.state ?? 'unregistered',
        availability,
      };
    } catch {
      return { ...base, selected: false, reason: 'availability_read_failed' };
    }
  });
  try {
    observability?.recordContent({ kind: 'source.selection', value: selection });
  } catch {
    // Source eligibility is independent of whether its evidence can be persisted.
  }
  return selection.filter(({ selected }) => selected).map(({ sourceId }) => sourceId);
}

function countAdditions(
  before: CandidatePoolSnapshot,
  after: CandidatePoolSnapshot | undefined,
  summary: CandidateSupplyAttemptSummary,
): { readonly candidates: number; readonly matches: number; } {
  const beforeCandidateIds = new Set(before.candidates.map(({ candidate }) => candidate.id));
  const beforeMatchIds = new Set(
    before.candidates.flatMap(({ interestMatches }) => interestMatches.map(({ id }) => id)),
  );
  const snapshotCandidates = after
    ? after.candidates.filter(({ candidate }) => !beforeCandidateIds.has(candidate.id)).length
    : 0;
  const snapshotMatches = after
    ? after.candidates
      .flatMap(({ interestMatches }) => interestMatches)
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
    return repository.getCandidatePoolSnapshot(settings);
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
  failure: { readonly code: string; readonly message: string; readonly retryable: boolean; },
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
  reason: Extract<CandidateSupplyResult, { status: 'not_needed'; }>['reason'],
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
    return await observability.withTrace(
      {
        kind: 'candidate_supply',
        correlation: { requestId },
        classifyResult: classifyResult,
      },
      runOnce,
    );
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

function reportBackgroundError(options: CreateCandidatesOptions, error: unknown): void {
  try {
    options.onBackgroundError?.(error);
  } catch {
    // The observer is the terminal boundary for background diagnostics.
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0)
    throw new Error(`${name} must be a positive integer.`);
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

export type { CandidateSupplyTrigger } from '../candidates/candidate-pool';

function readConfiguration(settings: Pick<Settings, 'readSettings'>) {
  const result = settings.readSettings();
  if (result.status === 'rejected') throw new Error(result.error.message);
  return result.settings.config;
}
