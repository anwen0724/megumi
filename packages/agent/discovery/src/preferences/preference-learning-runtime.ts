/*
 * Owns exact Preference Learning wakeups, single-flight batch execution, one
 * Context-built ordinary model Completion, and deterministic commit/failure
 * recovery. It never creates an Agent Execution or exposes Tools.
 */
import type { Api, Model, Models } from '@megumi/ai';
import type { ContextBuilder } from '@megumi/context';
import type { Observability, OperationCompletion, TraceCorrelation } from '@megumi/observability';
import { z } from 'zod';
import type { PreferenceLearningRepository } from '../persistence/preference-learning-repository';

const ModelDirectionSchema = z.object({
  directionId: z.string(),
  polarity: z.enum(['positive', 'negative']),
  dimension: z.enum([
    'topic', 'source', 'author', 'content_type', 'recency', 'expression_quality',
  ]),
  statement: z.string().trim().min(1).max(1000),
  supportingFeedbackIds: z.array(z.string().min(1)).min(1),
}).strict();
const ModelResultSchema = z.object({
  scopes: z.array(z.object({
    scopeKey: z.string().min(1),
    baseRevision: z.number().int().nonnegative(),
    directions: z.array(ModelDirectionSchema),
  }).strict()),
}).strict();

export interface PreferenceLearningRuntime {
  start(): Promise<void>;
  notifyFeedbackChanged(): void;
  shutdown(): Promise<void>;
}

export interface CreatePreferenceLearningRuntimeOptions {
  readonly repository: PreferenceLearningRepository;
  readonly context: Pick<ContextBuilder, 'build'>;
  readonly models: Pick<Models, 'completeSimple'>;
  readonly resolveModel: () => Promise<Model<Api> | undefined>;
  readonly ids: {
    createBatchId(): string;
    createModelCallId(): string;
    createDirectionId(): string;
  };
  readonly now: () => string;
  readonly observability?: Observability;
  readonly timers?: {
    set(delayMs: number, callback: () => void): unknown;
    clear(handle: unknown): void;
  };
  readonly onPreferencesCommitted?: (interestIds: readonly string[]) => void;
  readonly onBackgroundError?: (error: unknown) => void;
}

/** Creates the single background owner for durable Feedback-to-Preference learning. */
export function createPreferenceLearningRuntime(
  options: CreatePreferenceLearningRuntimeOptions,
): PreferenceLearningRuntime {
  const timers = options.timers ?? nodeTimers();
  let accepting = true;
  let timer: unknown;
  let running: Promise<void> | undefined;
  let rerunRequested = false;
  let activeController: AbortController | undefined;

  function clearTimer(): void {
    if (timer === undefined) return;
    timers.clear(timer);
    timer = undefined;
  }

  function schedule(dueAt: string): void {
    if (!accepting) return;
    clearTimer();
    const delay = Math.max(0, Date.parse(dueAt) - Date.parse(options.now()));
    timer = timers.set(delay, () => {
      timer = undefined;
      wake();
    });
  }

  function wake(): void {
    if (!accepting) return;
    clearTimer();
    if (running) {
      rerunRequested = true;
      return;
    }
    running = drain().catch((error) => {
      safeReport(options, error);
    }).finally(() => {
      running = undefined;
      if (rerunRequested && accepting) {
        rerunRequested = false;
        wake();
      }
    });
  }

  async function drain(): Promise<void> {
    while (accepting) {
      const trigger = options.repository.readPreferenceLearningTrigger({ now: options.now() });
      if (trigger.status === 'idle') return;
      if (trigger.status === 'scheduled') {
        schedule(trigger.dueAt);
        return;
      }
      const batchId = options.ids.createBatchId();
      const controller = new AbortController();
      activeController = controller;
      const result = await observeLearningTrace(options.observability, batchId, async () => {
        const batch = await observeSpan(
          options.observability,
          'preference.batch.claim',
          { batchId },
          () => Promise.resolve(options.repository.claimPreferenceLearningBatch({
            batchId,
            reason: trigger.reason,
            now: options.now(),
            limit: 20,
          })),
        );
        if (!batch) return { status: 'idle' as const };
        return processBatch(options, batch.batchId, batch.startedAt, controller.signal);
      }).finally(() => {
        if (activeController === controller) activeController = undefined;
      });
      if (result.status === 'idle') return;
    }
  }

  return {
    async start() {
      accepting = true;
      options.repository.interruptPreferenceLearningBatches({ now: options.now() });
      wake();
    },
    notifyFeedbackChanged: wake,
    async shutdown() {
      accepting = false;
      clearTimer();
      activeController?.abort();
      await running;
    },
  };
}

async function processBatch(
  options: CreatePreferenceLearningRuntimeOptions,
  batchId: string,
  startedAt: string,
  signal: AbortSignal,
): Promise<LearningBatchResult> {
  try {
    const model = await options.resolveModel();
    if (!model) throw new LearningFailure('model_unavailable', 'Preference Learning model is unavailable.');
    const modelCallId = options.ids.createModelCallId();
    const built = await options.context.build({
      modelCallContext: {
        modelCallId,
        run: { kind: 'preference_learning', batchId, startedAt, model },
        tools: [],
      },
      currentMessages: [],
      signal,
    });
    if (built.status === 'failed') {
      throw new LearningFailure(built.failure.code, built.failure.message);
    }
    const modelCorrelation = { batchId, modelCallId };
    const modelRequest = {
      model: {
        providerId: model.provider,
        modelId: model.id,
      },
      prompt: built.prompt,
    };
    safeRecordContent(options.observability, 'model.request', modelRequest, modelCorrelation);
    const response = await observeSpan(
      options.observability,
      'model.call',
      modelCorrelation,
      () => options.models.completeSimple(model, {
        systemPrompt: built.prompt.systemPrompt,
        messages: [...built.prompt.messages],
      }, { sessionId: `preference-learning:${batchId}`, signal }),
    );
    safeRecordContent(options.observability, 'model.response', response, modelCorrelation);
    if (response.stopReason === 'error' || response.stopReason === 'aborted') {
      throw new LearningFailure('model_completion_failed', response.errorMessage ?? 'Preference Learning model failed.');
    }
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();
    const learned = ModelResultSchema.parse(JSON.parse(stripCodeFence(text)));
    safeRecordContent(options.observability, 'preference.learning.result', learned, modelCorrelation);
    const scopes = learned.scopes.map((scope) => ({
      scopeKey: scope.scopeKey,
      baseRevision: scope.baseRevision,
      directions: scope.directions.map((direction) => ({
        ...direction,
        directionId: direction.directionId || options.ids.createDirectionId(),
      })),
    }));
    const committed = await observeSpan(
      options.observability,
      'preference.commit',
      { batchId },
      () => Promise.resolve(options.repository.commitPreferenceLearningBatch({
        batchId,
        committedAt: options.now(),
        scopes,
      })),
    );
    if (committed.status === 'rejected') {
      throw new LearningFailure(committed.reason, 'Preference Learning commit was rejected.');
    }
    safeRecordContent(options.observability, 'preference.committed', {
      batchId,
      scopes,
      affectedInterestIds: committed.affectedInterestIds,
    }, { batchId });
    safeNotifyCommitted(options, committed.affectedInterestIds);
    return { status: 'committed' };
  } catch (error) {
    const failure = error instanceof LearningFailure
      ? error
      : new LearningFailure('preference_learning_failed', messageOf(error));
    const failedAt = options.now();
    await observeSpan(
      options.observability,
      'preference.batch.settle',
      { batchId },
      () => Promise.resolve(options.repository.failPreferenceLearningBatch({
        batchId,
        failedAt,
        retryAt: new Date(Date.parse(failedAt) + 60_000).toISOString(),
        failureCode: failure.code,
        failureMessage: failure.message,
      })),
    );
    safeReport(options, error);
    return { status: 'failed', failure };
  }
}

type LearningBatchResult =
  | { readonly status: 'idle' | 'committed' }
  | { readonly status: 'failed'; readonly failure: LearningFailure };

class LearningFailure extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'LearningFailure';
  }
}

function stripCodeFence(value: string): string {
  const match = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  return match?.[1] ?? value;
}

function safeNotifyCommitted(
  options: CreatePreferenceLearningRuntimeOptions,
  interestIds: readonly string[],
): void {
  try {
    options.onPreferencesCommitted?.(interestIds);
  } catch {
    // Downstream invalidation is retried from durable revision facts.
  }
}

function safeReport(options: CreatePreferenceLearningRuntimeOptions, error: unknown): void {
  try {
    options.onBackgroundError?.(error);
  } catch {
    // Error reporting cannot create a second background failure.
  }
}

async function observeLearningTrace(
  observability: Observability | undefined,
  batchId: string,
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
      correlation: { batchId },
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
      retryable: true,
    },
  };
}

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
