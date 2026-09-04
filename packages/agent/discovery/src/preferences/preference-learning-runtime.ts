/*
 * Owns one ephemeral Preference learning snapshot and bounded in-process retries.
 * Restart recovery uses durable feedback versions, never execution history.
 */
import { randomUUID } from 'node:crypto';
import type { Api, Model, Models } from '@megumi/ai';
import type { ContextBuilder } from '@megumi/context';
import type { Observability, OperationCompletion, TraceCorrelation } from '@megumi/observability';
import { z } from 'zod';
import type { PreferenceLearningRepository } from '../persistence/preference-learning-repository';
import { LearnedPreferenceInputSchema, type PreferenceLearningFacts } from './preference';

const ModelResultSchema = z.object({
  scopes: z.array(z.object({
    preferenceSetId: z.string().min(1), baseRevision: z.number().int().nonnegative(),
    preferences: z.array(LearnedPreferenceInputSchema.extend({ id: z.string() }).strict()),
  }).strict()),
}).strict();

export interface PreferenceLearningRuntime {
  /** Starts local recovery from unlearned feedback; automatic work can be disabled by Evaluation. */
  start(options?: { readonly automaticTriggers?: boolean }): Promise<void>;
  /** Rechecks learning eligibility after an actual feedback change. */
  notifyReactionChanged(): void;
  /** Supplies only the active immutable work snapshot to Context. */
  getActivePreferenceLearningFacts(batchId: string): PreferenceLearningFacts | undefined;
  /** Returns current scheduling/attempt state without persisting execution history. */
  getPreferenceLearningStatus(recommendationId: string): PreferenceLearningStatus;
  /** Cancels pending work and waits until no result can commit. */
  shutdown(): Promise<void>;
}
export type PreferenceLearningStatus =
  | { readonly status: 'idle' }
  | { readonly status: 'scheduled'; readonly dueAt: string }
  | { readonly status: 'running'; readonly batchId: string }
  | { readonly status: 'failed'; readonly batchId: string; readonly code: string; readonly message: string; readonly retryAt?: string };
export interface CreatePreferenceLearningRuntimeOptions {
  readonly repository: PreferenceLearningRepository;
  readonly context: Pick<ContextBuilder, 'build'>;
  readonly models: Pick<Models, 'completeSimple'>;
  readonly resolveModel: () => Promise<Model<Api> | undefined>;
  readonly ids: { createBatchId(): string; createModelCallId(): string };
  readonly now: () => string;
  readonly observability?: Observability;
  readonly timers?: { set(delayMs: number, callback: () => void): unknown; clear(handle: unknown): void };
  readonly onPreferencesCommitted?: (interestIds: readonly string[]) => void;
  readonly onBackgroundError?: (error: unknown) => void;
}

/** Serializes feedback learning without persisting a parallel execution state machine. */
export function createPreferenceLearningRuntime(options: CreatePreferenceLearningRuntimeOptions): PreferenceLearningRuntime {
  const timers = options.timers ?? nodeTimers();
  let accepting = true;
  let timer: unknown;
  let running: Promise<void> | undefined;
  let active: PreferenceLearningFacts | undefined;
  let controller: AbortController | undefined;
  let rerunRequested = false;
  let failures = 0;
  let dueAt: string | undefined;
  let lastFailure: { readonly facts: PreferenceLearningFacts; readonly code: string; readonly message: string } | undefined;
  const clearTimer = () => {
    if (timer !== undefined) timers.clear(timer);
    timer = undefined;
    dueAt = undefined;
  };
  const schedule = (delayMs: number) => {
    clearTimer();
    dueAt = new Date(Date.parse(options.now()) + Math.max(0, delayMs)).toISOString();
    timer = timers.set(Math.max(0, delayMs), () => { timer = undefined; wake(); });
  };
  const wake = () => {
    if (!accepting) return;
    clearTimer();
    if (running) { rerunRequested = true; return; }
    running = drain().catch((error: unknown) => safeReport(options, error)).finally(() => {
      running = undefined;
      if (rerunRequested && accepting) { rerunRequested = false; wake(); }
    });
  };
  async function drain(): Promise<void> {
    while (accepting) {
      const trigger = options.repository.getPreferenceLearningTrigger({ now: options.now() });
      if (trigger.status === 'idle') return;
      if (trigger.status === 'scheduled') { schedule(Date.parse(trigger.dueAt) - Date.parse(options.now())); return; }
      const batchId = options.ids.createBatchId();
      controller = new AbortController();
      const signal = controller.signal;
      const facts = options.repository.preparePreferenceLearning({ batchId, startedAt: options.now(), limit: 20 });
      if (!facts) return;
      active = facts;
      let result: LearningBatchResult;
      try {
        result = await observeLearningTrace(options.observability, facts, () => processBatch(options, facts, signal));
      } finally {
        active = undefined;
        controller = undefined;
      }
      if (!accepting || signal.aborted) return;
      if (result.status === 'failed') {
        lastFailure = { facts, code: result.failure.code, message: result.failure.message };
        failures += 1;
        // A new feedback revision or restart can retry again; old failures do not poll forever.
        if (result.retryable && failures < 3) schedule(60_000);
        return;
      }
      failures = 0;
      lastFailure = undefined;
    }
  }
  return {
    async start(startOptions = {}) { accepting = true; failures = 0; if (startOptions.automaticTriggers ?? true) wake(); },
    notifyReactionChanged() { failures = 0; lastFailure = undefined; wake(); },
    getActivePreferenceLearningFacts: (id) => active?.batch.batchId === id ? active : undefined,
    getPreferenceLearningStatus(recommendationId) {
      if (active?.reactionChanges.some((entry) => entry.recommendationId === recommendationId)) return { status: 'running', batchId: active.batch.batchId };
      const completion = options.repository.getPreferenceLearningCompletion(recommendationId);
      if (!completion || completion.status === 'learned') return { status: 'idle' };
      if (lastFailure?.facts.reactionChanges.some((entry) => entry.recommendationId === recommendationId && entry.currentReactionRevision === completion.currentReactionRevision)) {
        return { status: 'failed', batchId: lastFailure.facts.batch.batchId, code: lastFailure.code, message: lastFailure.message, ...(dueAt ? { retryAt: dueAt } : {}) };
      }
      return dueAt ? { status: 'scheduled', dueAt } : { status: 'idle' };
    },
    async shutdown() {
      accepting = false;
      clearTimer();
      controller?.abort();
      await running;
      active = undefined;
    },
  };
}

/** Calls the model once, then lets the Repository atomically validate and publish the result. */
async function processBatch(
  options: CreatePreferenceLearningRuntimeOptions, facts: PreferenceLearningFacts, signal: AbortSignal,
): Promise<LearningBatchResult> {
  const { batchId, startedAt } = facts.batch;
  try {
    const model = await options.resolveModel();
    if (!model) throw new LearningFailure('model_unavailable', 'Preference Learning model is unavailable.', false);
    if (signal.aborted) throw new LearningFailure('cancelled', 'Preference Learning was cancelled.', false);
    const modelCallId = options.ids.createModelCallId();
    const built = await options.context.build({
      modelCallContext: { modelCallId, run: { kind: 'preference_learning', batchId, startedAt, model }, tools: [] },
      currentMessages: [], signal,
    });
    if (built.status === 'failed') throw new LearningFailure(built.failure.code, built.failure.message, false);
    const correlation = { preferenceLearningBatchId: batchId, modelCallId };
    safeRecordContent(options.observability, 'model.request', {
      model: { providerId: model.provider, modelId: model.id }, prompt: built.prompt,
    }, correlation);
    const response = await observeSpan(options.observability, 'model.call', correlation, () => (
      options.models.completeSimple(model, { systemPrompt: built.prompt.systemPrompt, messages: [...built.prompt.messages] },
        { sessionId: `preference-learning:${batchId}`, signal })
    ));
    safeRecordContent(options.observability, 'model.response', response, correlation);
    if (signal.aborted || response.stopReason === 'aborted') throw new LearningFailure('cancelled', 'Preference Learning was cancelled.', false);
    if (response.stopReason === 'error') throw new LearningFailure('model_completion_failed', response.errorMessage ?? 'Model failed.', true);
    const text = response.content.filter((block) => block.type === 'text').map((block) => block.text).join('').trim();
    const learned = ModelResultSchema.parse(JSON.parse(stripCodeFence(text)));
    safeRecordContent(options.observability, 'preference.learning.result', learned, correlation);
    const existingIds = new Set(facts.currentPreferences.flatMap(({ preferences }) => preferences.map(({ preference }) => preference.id)));
    if (learned.scopes.some((scope) => scope.preferences.some(({ id }) => id !== '' && !existingIds.has(id)))) {
      throw new LearningFailure('invalid_preference_reference', 'Model returned an unknown Preference ID.', false);
    }
    const scopes = learned.scopes.map((scope) => ({
      ...scope, preferences: scope.preferences.map((preference) => ({ ...preference, id: preference.id || randomUUID() })),
    }));
    const committed = await observeSpan(options.observability, 'preference.commit', { preferenceLearningBatchId: batchId }, () => (
      Promise.resolve(options.repository.commitPreferenceLearning({ facts, scopes, committedAt: options.now() }))
    ));
    if (committed.status === 'rejected') {
      throw new LearningFailure(committed.reason, 'Preference Learning commit was rejected.',
        committed.reason === 'revision_conflict' || committed.reason === 'invalid_interest_reference');
    }
    safeRecordContent(options.observability, 'preference.committed', {
      batchId, scopes, affectedInterestIds: committed.affectedInterestIds,
      recommendationIds: facts.reactionChanges.map(({ recommendationId }) => recommendationId),
    }, { preferenceLearningBatchId: batchId });
    try { options.onPreferencesCommitted?.(committed.affectedInterestIds); }
    catch (error) { safeReport(options, error); }
    return { status: 'committed' };
  } catch (error) {
    const failure = error instanceof LearningFailure ? error : new LearningFailure('preference_learning_failed', messageOf(error), false);
    safeReport(options, error);
    return { status: 'failed', failure, retryable: failure.retryable };
  }
}
type LearningBatchResult = { readonly status: 'committed' } | { readonly status: 'failed'; readonly failure: LearningFailure; readonly retryable: boolean };
class LearningFailure extends Error {
  constructor(readonly code: string, message: string, readonly retryable: boolean) { super(message); }
}
function stripCodeFence(value: string): string { return value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu)?.[1] ?? value; }
function safeReport(options: CreatePreferenceLearningRuntimeOptions, error: unknown): void {
  try { options.onBackgroundError?.(error); } catch { /* Error reporting cannot mutate committed business data. */ }
}

/** Isolates diagnostic failures while ensuring business work executes at most once. */
async function observeLearningTrace(
  observability: Observability | undefined,
  facts: PreferenceLearningFacts,
  operation: () => Promise<LearningBatchResult>,
): Promise<LearningBatchResult> {
  let promise: Promise<LearningBatchResult> | undefined;
  const runOnce = () => {
    promise ??= operation();
    return promise;
  };
  if (!observability) return runOnce();
  try {
    return await observability.withTrace({
      kind: 'preference_learning',
      correlation: { preferenceLearningBatchId: facts.batch.batchId, recommendationIds: facts.reactionChanges.map(({ recommendationId }) => recommendationId) },
      classifyResult: classifyLearningResult,
    }, runOnce);
  } catch {
    return runOnce();
  }
}

function classifyLearningResult(result: LearningBatchResult): OperationCompletion {
  if (result.status !== 'failed') return { outcome: { status: 'ok', code: result.status } };
  return {
    outcome: {
      status: 'error',
      code: result.failure.code,
      message: result.failure.message,
      retryable: result.retryable,
    },
  };
}

/** Observes one operation without replaying it when diagnostic infrastructure fails. */
async function observeSpan<T>(
  observability: Observability | undefined,
  name: Parameters<Observability['withSpan']>[0]['name'],
  correlation: TraceCorrelation,
  operation: () => Promise<T>,
): Promise<T> {
  let promise: Promise<T> | undefined;
  const runOnce = () => {
    promise ??= operation();
    return promise;
  };
  if (!observability) return runOnce();
  try {
    return await observability.withSpan({
      name,
      correlation,
      classifyResult: (): OperationCompletion => ({ outcome: { status: 'ok' } }),
    }, runOnce);
  } catch {
    return runOnce();
  }
}

function safeRecordContent(
  observability: Observability | undefined,
  kind: Parameters<Observability['recordContent']>[0]['kind'],
  value: unknown,
  correlation: TraceCorrelation,
): void {
  try {
    observability?.recordContent({ kind, value, correlation });
  } catch {
    // Trace capture cannot alter Feedback or Preference business state.
  }
}

function nodeTimers() {
  return {
    set: (delayMs: number, callback: () => void) => setTimeout(callback, delayMs),
    clear: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Preference Learning failed.';
}
