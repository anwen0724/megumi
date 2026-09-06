/*
 * Owns one ephemeral Preference learning snapshot and bounded in-process retries.
 * Restart recovery uses durable feedback versions, never execution history.
 */
import type { Api, Model, Models } from '@megumi/ai';
import { calculatePromptUsage, type ContextBuilder } from '@megumi/context';
import type { Observability, OperationCompletion, TraceCorrelation } from '@megumi/observability';
import { z } from 'zod';
import type { PreferenceLearningRepository } from '../persistence/preference-learning-repository';
import { LearnedScopeInputSchema, PreferenceScopeRequestSchema, PreferenceSetDetailSchema, PreferenceGuardSchema, type PreferenceLearningFacts, type LearnedScopeInput } from './preference';

import { PREFERENCE_LEARNING_POLICY as policy } from './preference-learning-policy';

const ModelResultSchema = z.object({ scopes: z.array(LearnedScopeInputSchema) }).strict();

export const PreparePreferencesRequestSchema = z.object({
  requestId: z.string().min(1), scopes: z.array(PreferenceScopeRequestSchema).optional(), signal: z.instanceof(AbortSignal).optional(),
}).strict();
export const PreparePreferencesResultSchema = z.object({
  status: z.enum(['unchanged', 'updated', 'degraded', 'cancelled']), preferences: z.array(PreferenceSetDetailSchema),
  guard: PreferenceGuardSchema,
  scopeResults: z.array(z.object({ preferenceSetId: z.string(), status: z.enum(['processed', 'pending']), revision: z.number().int().nonnegative(), outcome: z.enum(['changed', 'unchanged', 'insufficient']).optional() }).strict()),
  failures: z.array(z.object({ code: z.string(), message: z.string() }).strict()),
}).strict();
export type PreparePreferencesRequest = z.infer<typeof PreparePreferencesRequestSchema>;
export type PreparePreferencesResult = z.infer<typeof PreparePreferencesResultSchema>;

export interface PreferenceLearningRuntime {
  /** Learns pending inputs only when a recommendation or controlled evaluation requests them. */
  preparePreferencesForRecommendation(request: PreparePreferencesRequest): Promise<PreparePreferencesResult>;
  /** Opens the runtime without starting model work. */
  start(options?: { readonly automaticTriggers?: boolean }): Promise<void>;
  /** Clears obsolete diagnostics after feedback; never schedules model work. */
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
  readonly onPreferencesCommitted?: (interestIds: readonly string[]) => void;
  readonly onBackgroundError?: (error: unknown) => void;
}

/** Serializes feedback learning without persisting a parallel execution state machine. */
export function createPreferenceLearningRuntime(options: CreatePreferenceLearningRuntimeOptions): PreferenceLearningRuntime {
  let accepting = true;
  let active: PreferenceLearningFacts | undefined;
  let running: Promise<PreparePreferencesResult> | undefined;
  let controller: AbortController | undefined;
  let lastFailure: { code: string; message: string; batchId: string } | undefined;

  async function prepare(request: PreparePreferencesRequest, remainingMs: number): Promise<PreparePreferencesResult> {
    const cancellation = new AbortController();
    controller = cancellation;
    const cancel = () => cancellation.abort();
    request.signal?.addEventListener('abort', cancel, { once: true });
    if (request.signal?.aborted || !accepting) cancellation.abort();
    const deadline = setTimeout(cancel, remainingMs);
    const failures: Array<{ code: string; message: string }> = [];
    let updated = false;
    try {
      // Capture the work set once: new feedback cannot keep one request draining forever.
      const initial = options.repository.preparePreferenceLearning({ batchId: options.ids.createBatchId(), startedAt: options.now(), limit: policy.recentFeedbackCount });
      const groups = initial?.currentPreferences.filter(({ preferenceSet }) => !request.scopes || request.scopes.some((scope) => scope.scope === preferenceSet.scope && (scope.scope === 'exploration' || scope.interestId === preferenceSet.interestId))) ?? [];
      for (const group of groups) {
        for (let attempt = 0; attempt < policy.maximumAttempts && !cancellation.signal.aborted; attempt++) {
          const facts = options.repository.preparePreferenceLearning({ batchId: options.ids.createBatchId(), startedAt: options.now(), limit: policy.recentFeedbackCount, preferenceSetId: group.preferenceSet.id });
          if (!facts) break;
          active = facts;
          let result: LearningBatchResult;
          try {
            if (!facts.reviewedPreferenceIds.length && !facts.supportingReactions.length) {
              const committed = options.repository.commitPreferenceLearning({ facts, committedAt: options.now(), scopes: facts.currentPreferences.map(({ preferenceSet }) => ({ preferenceSetId: preferenceSet.id, baseRevision: preferenceSet.revision, changes: [], reviewedPreferenceIds: [], outcome: 'insufficient' })) });
              result = committed.status === 'committed' ? { status: 'committed' } : { status: 'failed', failure: new LearningFailure(committed.reason, 'Inputs changed.', true), retryable: true };
            } else result = await observeLearningTrace(options.observability, facts, () => processBatch(options, facts, cancellation.signal, (group) => { active = group; }));
          } finally { active = undefined; }
          if (result.status === 'committed') { updated = true; lastFailure = undefined; break; }
          lastFailure = { code: result.failure.code, message: result.failure.message, batchId: facts.batch.batchId };
          if (!result.retryable || attempt === policy.maximumAttempts - 1 || cancellation.signal.aborted) { failures.push({ code: result.failure.code, message: result.failure.message }); break; }
          await retryDelay(cancellation.signal);
        }
      }
      const cancelled = !accepting || request.signal?.aborted;
      if (cancellation.signal.aborted && !cancelled) failures.push({ code: 'timed_out', message: 'Preference preparation exceeded its time budget.' });
      return prepareResult(cancelled ? 'cancelled' : failures.length ? 'degraded' : updated ? 'updated' : 'unchanged', request, failures);
    } finally {
      clearTimeout(deadline);
      request.signal?.removeEventListener('abort', cancel);
      active = undefined;
      controller = undefined;
    }
  }
  function prepareResult(status: PreparePreferencesResult['status'], request: PreparePreferencesRequest, failures: PreparePreferencesResult['failures']): PreparePreferencesResult {
    const effective = options.repository.getEffectivePreferences(request.scopes);
    return PreparePreferencesResultSchema.parse({ status, ...effective, failures,
      scopeResults: effective.preferences.map(({ preferenceSet }) => ({ preferenceSetId: preferenceSet.id,
        status: preferenceSet.processedRevision === preferenceSet.revision ? 'processed' : 'pending', revision: preferenceSet.revision,
        ...(preferenceSet.processedRevision === preferenceSet.revision && preferenceSet.lastOutcome ? { outcome: preferenceSet.lastOutcome } : {}),
      })),
    });
  }
  return {
    async start() { accepting = true; },
    notifyReactionChanged() { lastFailure = undefined; },
    async preparePreferencesForRecommendation(request) {
      // Serial callers receive their own cancellation and scope semantics.
      const parsed = PreparePreferencesRequestSchema.parse(request);
      const started = Date.now();
      const queueSignal = AbortSignal.any([AbortSignal.timeout(policy.totalTimeoutMs), ...(parsed.signal ? [parsed.signal] : [])]);
      try { while (running) await abortable(running, queueSignal); }
      catch (error) {
        if (!queueSignal.aborted) throw error;
        return prepareResult(parsed.signal?.aborted ? 'cancelled' : 'degraded', parsed, parsed.signal?.aborted ? [] : [{ code: 'timed_out', message: 'Preference preparation exceeded its time budget.' }]);
      }
      if (parsed.signal?.aborted || !accepting) return prepareResult('cancelled', parsed, []);
      const operation = prepare(parsed, Math.max(1, policy.totalTimeoutMs - (Date.now() - started)));
      running = operation;
      try { return await operation; } finally { if (running === operation) running = undefined; }
    },
    getActivePreferenceLearningFacts: (id) => active?.batch.batchId === id ? active : undefined,
    getPreferenceLearningStatus(recommendationId) {
      if (active?.reactionChanges.some((entry) => entry.recommendationId === recommendationId)) return { status: 'running', batchId: active.batch.batchId };
      return lastFailure ? { status: 'failed', ...lastFailure } : { status: 'idle' };
    },
    async shutdown() { accepting = false; controller?.abort(); await running; },
  };
}

/** Waits only within an active preparation; never schedules background learning. */
async function retryDelay(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, policy.retryDelayMs);
    signal.addEventListener('abort', finish, { once: true });
  });
}

/** Calls the model once, then lets the Repository atomically validate and publish the result. */
async function processBatch(
  options: CreatePreferenceLearningRuntimeOptions, facts: PreferenceLearningFacts, signal: AbortSignal, setActive: (facts: PreferenceLearningFacts) => void,
): Promise<LearningBatchResult> {
  const { batchId, startedAt } = facts.batch;
  try {
    const model = await abortable(options.resolveModel(), signal);
    if (!model) throw new LearningFailure('model_unavailable', 'Preference Learning model is unavailable.', false);
    if (signal.aborted) throw new LearningFailure('cancelled', 'Preference Learning was cancelled.', false);
    const proposals = await proposeGroup(options, facts, model, signal, setActive, true);
    if (signal.aborted) throw new LearningFailure('cancelled', 'Preference Learning was cancelled.', false);
    const first = proposals[0];
    if (!first) throw new LearningFailure('invalid_output', 'Missing preference scope.', false);
    const changes = proposals.flatMap((proposal) => proposal.changes);
    const scopes: LearnedScopeInput[] = [{ ...first, changes, reviewedPreferenceIds: facts.reviewedPreferenceIds.slice(),
      outcome: changes.length ? 'changed' : proposals.some((proposal) => proposal.outcome === 'unchanged') ? 'unchanged' : 'insufficient' }];
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
/** Splits only independent review targets; every group retains user requirements and deletion facts. */
async function proposeGroup(
  options: CreatePreferenceLearningRuntimeOptions, facts: PreferenceLearningFacts, model: Model<Api>,
  signal: AbortSignal, setActive: (facts: PreferenceLearningFacts) => void, allowAdd: boolean,
): Promise<LearnedScopeInput[]> {
  const group = { ...facts, allowAdd };
  setActive(group);
  const modelCallId = options.ids.createModelCallId();
  const built = await abortable(options.context.build({
    modelCallContext: { modelCallId, run: { kind: 'preference_learning', batchId: facts.batch.batchId, startedAt: facts.batch.startedAt, model }, tools: [] },
    currentMessages: [], signal,
  }), signal);
  if (built.status === 'failed') throw new LearningFailure(built.failure.code, built.failure.message, false);
  const outputTokens = Math.min(model.maxTokens, policy.maximumOutputTokens);
  const budget = Math.min(policy.maximumInputTokens, Math.floor((model.contextWindow - outputTokens) * policy.contextBudgetRatio));
  if (calculatePromptUsage({ prompt: built.prompt }).tokens > budget) {
    if (facts.reviewedPreferenceIds.length < 2) throw new LearningFailure('input_too_large', 'Required preference evidence exceeds the input budget.', false);
    const middle = Math.ceil(facts.reviewedPreferenceIds.length / 2);
    const left = await proposeGroup(options, reviewGroup(facts, facts.reviewedPreferenceIds.slice(0, middle)), model, signal, setActive, allowAdd);
    const right = await proposeGroup(options, reviewGroup(facts, facts.reviewedPreferenceIds.slice(middle)), model, signal, setActive, false);
    return [...left, ...right];
  }
  const correlation = { preferenceLearningBatchId: facts.batch.batchId, modelCallId };
  safeRecordContent(options.observability, 'model.request', { model: { providerId: model.provider, modelId: model.id }, prompt: built.prompt }, correlation);
  const response = await observeSpan(options.observability, 'model.call', correlation, () => abortable(options.models.completeSimple(model,
    { systemPrompt: built.prompt.systemPrompt, messages: [...built.prompt.messages] },
    { sessionId: `preference-learning:${facts.batch.batchId}`, signal, maxTokens: outputTokens }), signal));
  safeRecordContent(options.observability, 'model.response', response, correlation);
  if (signal.aborted || response.stopReason === 'aborted') throw new LearningFailure('cancelled', 'Preference Learning was cancelled.', false);
  if (response.stopReason === 'error') throw new LearningFailure('model_completion_failed', response.errorMessage ?? 'Model failed.', true);
  const text = response.content.filter((block) => block.type === 'text').map((block) => block.text).join('').trim();
  const learned = ModelResultSchema.parse(JSON.parse(stripCodeFence(text)));
  const proposal = learned.scopes[0];
  const expectedSet = facts.currentPreferences[0]?.preferenceSet;
  if (learned.scopes.length !== 1 || !proposal || !expectedSet || (proposal.changes.length > 0) !== (proposal.outcome === 'changed') || proposal.preferenceSetId !== expectedSet.id || proposal.baseRevision !== expectedSet.revision
    || JSON.stringify([...proposal.reviewedPreferenceIds].sort()) !== JSON.stringify([...facts.reviewedPreferenceIds].sort())
    || proposal.changes.some((change) => change.kind === 'add' ? !allowAdd : !facts.reviewedPreferenceIds.includes(change.preferenceId))) {
    throw new LearningFailure('invalid_output', 'Model changed a read-only preference or returned the wrong review group.', false);
  }
  safeRecordContent(options.observability, 'preference.learning.result', learned, correlation);
  return [proposal];
}

/** Retains complete direct evidence for this group plus pending and recent historical feedback. */
function reviewGroup(facts: PreferenceLearningFacts, ids: readonly string[]): PreferenceLearningFacts {
  const direct = new Set(facts.currentPreferences.flatMap(({ preferences }) => preferences.filter(({ preference }) => ids.includes(preference.id)).flatMap(({ evidence }) => evidence.map((item) => item.recommendationId))));
  const recent = new Set(facts.supportingReactions.slice().sort((a, b) => b.reactionSequence - a.reactionSequence || a.recommendationId.localeCompare(b.recommendationId)).slice(0, policy.recentFeedbackCount).map((item) => item.recommendationId));
  const feedback = facts.reactionChanges.filter((item) => item.currentReactionRevision > item.learnedReactionRevision || direct.has(item.recommendationId) || recent.has(item.recommendationId));
  const included = new Set(feedback.map((item) => item.recommendationId));
  return { ...facts, reviewedPreferenceIds: ids, reactionChanges: feedback, supportingReactions: facts.supportingReactions.filter((item) => included.has(item.recommendationId)),
    currentPreferences: facts.currentPreferences.map((group) => ({ ...group, preferences: group.preferences.map((entry) => ids.includes(entry.preference.id) ? entry : { ...entry, evidence: [] }) })) };
}

/** Bounds non-cooperative providers too; late responses are observed but can never commit. */
async function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new LearningFailure('cancelled', 'Preference Learning was cancelled.', false));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    void operation.then((value) => { signal.removeEventListener('abort', abort); resolve(value); }, (error: unknown) => { signal.removeEventListener('abort', abort); reject(error); });
  });
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Preference Learning failed.';
}
