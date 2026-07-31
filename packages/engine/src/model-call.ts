/*
 * Executes one Engine-owned ModelCall through Models with isolated retry buffers.
 */
import {
  classifyModelFailure,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Context,
  type Model,
  type ModelFailure,
  type Models,
  type ModelsSimpleStreamOptions,
  type ToolCall,
} from '@megumi/ai';
import type { EngineClock } from './engine';
import type { EnginePolicy } from './engine-policy';

export type ModelCallStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface ModelCallFailure {
  readonly code: ModelFailure['code'] | 'timeout' | 'invalid_response';
  readonly message: string;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
}

export interface ModelCall {
  readonly modelCallId: string;
  readonly runId: string;
  readonly status: ModelCallStatus;
  readonly createdAt: string;
  readonly completedAt?: string;
  readonly failure?: ModelCallFailure;
}

export interface CompletedModelToolCall {
  readonly toolCallId: string;
  readonly sourceModelCallId: string;
  readonly callOrder: number;
  readonly toolName: string;
  readonly input: unknown;
}

export interface ModelCallPartialOutput {
  readonly text: string;
  readonly thinking: string;
}

export type ModelCallEvent =
  | {
      readonly type: 'started';
      readonly modelCall: ModelCall;
      readonly createdAt: string;
    }
  | {
      readonly type: 'attempt_started';
      readonly modelCallId: string;
      readonly attemptNumber: number;
      readonly maxAttempts: number;
      readonly createdAt: string;
    }
  | {
      readonly type: 'text_delta';
      readonly modelCallId: string;
      readonly attemptNumber: number;
      readonly delta: string;
      readonly createdAt: string;
    }
  | {
      readonly type: 'thinking_started' | 'thinking_completed';
      readonly modelCallId: string;
      readonly attemptNumber: number;
      readonly createdAt: string;
    }
  | {
      readonly type: 'thinking_delta';
      readonly modelCallId: string;
      readonly attemptNumber: number;
      readonly delta: string;
      readonly createdAt: string;
    }
  | {
      readonly type: 'projection_reset';
      readonly modelCallId: string;
      readonly failedAttemptNumber: number;
      readonly createdAt: string;
    }
  | {
      readonly type: 'retrying';
      readonly modelCallId: string;
      readonly failedAttemptNumber: number;
      readonly nextAttemptNumber: number;
      readonly maxAttempts: number;
      readonly failure: ModelCallFailure;
      readonly retryAfterMs: number;
      readonly createdAt: string;
    }
  | {
      readonly type: 'completed';
      readonly modelCall: ModelCall;
      readonly message: AssistantMessage;
      readonly toolCalls: readonly CompletedModelToolCall[];
      readonly createdAt: string;
    }
  | {
      readonly type: 'failed';
      readonly modelCall: ModelCall;
      readonly failure: ModelCallFailure;
      readonly partial: ModelCallPartialOutput;
      readonly createdAt: string;
    };

export type ModelCallWait = (delayMs: number, signal: AbortSignal) => Promise<void>;

export interface ExecuteModelCallRequest {
  readonly modelCallId: string;
  readonly runId: string;
  readonly sessionId: string;
  readonly models: Models;
  readonly model: Model<Api>;
  readonly context: Context;
  readonly options?: Omit<
    ModelsSimpleStreamOptions,
    'signal' | 'sessionId' | 'timeoutMs' | 'maxRetries'
  >;
  readonly signal: AbortSignal;
  readonly policy: Pick<
    EnginePolicy,
    'maxModelCallAttempts' | 'modelCallTimeoutMs' | 'modelRetryDelayMs'
  >;
  readonly clock: EngineClock;
  /** Test seam for retry timing; production callers use the abort-aware default. */
  readonly wait?: ModelCallWait;
}

interface SuccessfulAttempt {
  readonly status: 'completed';
  readonly message: AssistantMessage;
  readonly toolCalls: readonly CompletedModelToolCall[];
}

interface FailedAttempt {
  readonly status: 'failed';
  readonly failure: ModelCallFailure;
  readonly partial: ModelCallPartialOutput;
}

type AttemptOutcome = SuccessfulAttempt | FailedAttempt;
type AttemptLiveEvent = Extract<
  ModelCallEvent,
  { type: 'text_delta' | 'thinking_started' | 'thinking_delta' | 'thinking_completed' }
>;

export async function* executeModelCall(
  request: ExecuteModelCallRequest,
): AsyncIterable<ModelCallEvent> {
  const createdAt = request.clock.now();
  const runningCall: ModelCall = {
    modelCallId: request.modelCallId,
    runId: request.runId,
    status: 'running',
    createdAt,
  };
  yield { type: 'started', modelCall: runningCall, createdAt };

  if (request.signal.aborted) {
    yield failedEvent(request, runningCall, abortedFailure(), emptyPartial());
    return;
  }

  const maxAttempts = request.policy.maxModelCallAttempts;
  const wait = request.wait ?? waitForRetry;

  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
    if (request.signal.aborted) {
      yield failedEvent(request, runningCall, abortedFailure(), emptyPartial());
      return;
    }

    yield {
      type: 'attempt_started',
      modelCallId: request.modelCallId,
      attemptNumber,
      maxAttempts,
      createdAt: request.clock.now(),
    };

    const attempt = runAttempt(request, attemptNumber);
    let outcome: AttemptOutcome;
    while (true) {
      const next = await attempt.next();
      if (next.done) {
        outcome = next.value;
        break;
      }
      yield next.value;
    }

    if (outcome.status === 'completed') {
      const completedAt = request.clock.now();
      yield {
        type: 'completed',
        modelCall: {
          ...runningCall,
          status: 'completed',
          completedAt,
        },
        message: outcome.message,
        toolCalls: outcome.toolCalls,
        createdAt: completedAt,
      };
      return;
    }

    const failure = request.signal.aborted ? abortedFailure() : outcome.failure;
    const canRetry = isRetryableFailure(failure)
      && attemptNumber < maxAttempts
      && !request.signal.aborted;
    if (!canRetry) {
      yield failedEvent(request, runningCall, failure, outcome.partial);
      return;
    }

    const retryAfterMs = Math.max(
      request.policy.modelRetryDelayMs,
      failure.retryAfterMs ?? 0,
    );
    // Live deltas may have been projected already. Reset them before announcing the retry.
    yield {
      type: 'projection_reset',
      modelCallId: request.modelCallId,
      failedAttemptNumber: attemptNumber,
      createdAt: request.clock.now(),
    };
    yield {
      type: 'retrying',
      modelCallId: request.modelCallId,
      failedAttemptNumber: attemptNumber,
      nextAttemptNumber: attemptNumber + 1,
      maxAttempts,
      failure,
      retryAfterMs,
      createdAt: request.clock.now(),
    };
    await wait(retryAfterMs, request.signal);
  }
}

async function* runAttempt(
  request: ExecuteModelCallRequest,
  attemptNumber: number,
): AsyncGenerator<AttemptLiveEvent, AttemptOutcome> {
  let partialText = '';
  let partialThinking = '';
  const timeoutController = new AbortController();
  const attemptSignal = AbortSignal.any([request.signal, timeoutController.signal]);
  const interruption = createAttemptInterruption({
    runSignal: request.signal,
    timeoutController,
    timeoutMs: request.policy.modelCallTimeoutMs,
  });

  let iterator: AsyncIterator<AssistantMessageEvent> | undefined;
  try {
    const stream = request.models.streamSimple(request.model, request.context, {
      ...request.options,
      sessionId: request.sessionId,
      signal: attemptSignal,
      timeoutMs: request.policy.modelCallTimeoutMs,
      // One Engine attempt must not hide extra SDK/provider retry attempts.
      maxRetries: 0,
    });
    iterator = stream[Symbol.asyncIterator]();

    while (true) {
      const next = iterator.next()
        .then((value) => ({ type: 'event' as const, value }))
        .catch((error: unknown) => ({ type: 'thrown' as const, error }));
      const outcome = await Promise.race([next, interruption.result]);

      if (outcome.type === 'interrupted') {
        closeIterator(iterator);
        return {
          status: 'failed',
          failure: outcome.reason === 'timeout' ? timeoutFailure() : abortedFailure(),
          partial: { text: partialText, thinking: partialThinking },
        };
      }

      if (outcome.type === 'thrown') {
        return {
          status: 'failed',
          failure: fromAiFailure(classifyModelFailure({
            reason: request.signal.aborted ? 'aborted' : 'error',
            error: outcome.error,
          })),
          partial: { text: partialText, thinking: partialThinking },
        };
      }

      if (outcome.value.done) {
        return {
          status: 'failed',
          failure: invalidResponseFailure('Model stream ended without a terminal event.'),
          partial: { text: partialText, thinking: partialThinking },
        };
      }

      const event = outcome.value.value;
      if (event.type === 'text_delta') {
        partialText += event.delta;
        yield {
          type: 'text_delta',
          modelCallId: request.modelCallId,
          attemptNumber,
          delta: event.delta,
          createdAt: request.clock.now(),
        };
        continue;
      }
      if (event.type === 'thinking_start') {
        yield {
          type: 'thinking_started',
          modelCallId: request.modelCallId,
          attemptNumber,
          createdAt: request.clock.now(),
        };
        continue;
      }
      if (event.type === 'thinking_delta') {
        partialThinking += event.delta;
        yield {
          type: 'thinking_delta',
          modelCallId: request.modelCallId,
          attemptNumber,
          delta: event.delta,
          createdAt: request.clock.now(),
        };
        continue;
      }
      if (event.type === 'thinking_end') {
        yield {
          type: 'thinking_completed',
          modelCallId: request.modelCallId,
          attemptNumber,
          createdAt: request.clock.now(),
        };
        continue;
      }
      if (event.type === 'error') {
        return {
          status: 'failed',
          failure: fromAiFailure(classifyModelFailure({
            reason: event.reason,
            failure: event.failure,
          })),
          partial: { text: partialText, thinking: partialThinking },
        };
      }
      if (event.type === 'done') {
        const toolCalls = completedToolCalls(request.modelCallId, event.message);
        if (toolCalls.status === 'invalid') {
          return {
            status: 'failed',
            failure: toolCalls.failure,
            partial: { text: partialText, thinking: partialThinking },
          };
        }
        return {
          status: 'completed',
          message: event.message,
          toolCalls: toolCalls.toolCalls,
        };
      }
      // ToolCall fragments stay inside this attempt. Only the final done message can commit them.
    }
  } catch (error) {
    return {
      status: 'failed',
      failure: fromAiFailure(classifyModelFailure({
        reason: request.signal.aborted ? 'aborted' : 'error',
        error,
      })),
      partial: { text: partialText, thinking: partialThinking },
    };
  } finally {
    interruption.dispose();
  }
}

function completedToolCalls(
  modelCallId: string,
  message: AssistantMessage,
):
  | { readonly status: 'valid'; readonly toolCalls: readonly CompletedModelToolCall[] }
  | { readonly status: 'invalid'; readonly failure: ModelCallFailure } {
  const calls = message.content.filter((block): block is ToolCall => block.type === 'toolCall');
  const seenIds = new Set<string>();
  const toolCalls: CompletedModelToolCall[] = [];

  for (const [callOrder, call] of calls.entries()) {
    if (!call.id || !call.name || seenIds.has(call.id)) {
      return {
        status: 'invalid',
        failure: invalidResponseFailure('Model response contained an invalid ToolCall identity.'),
      };
    }
    seenIds.add(call.id);
    toolCalls.push({
      toolCallId: call.id,
      sourceModelCallId: modelCallId,
      callOrder,
      toolName: call.name,
      input: call.arguments,
    });
  }

  return { status: 'valid', toolCalls };
}

function failedEvent(
  request: ExecuteModelCallRequest,
  runningCall: ModelCall,
  failure: ModelCallFailure,
  partial: ModelCallPartialOutput,
): Extract<ModelCallEvent, { type: 'failed' }> {
  const completedAt = request.clock.now();
  return {
    type: 'failed',
    modelCall: {
      ...runningCall,
      status: failure.code === 'aborted' ? 'cancelled' : 'failed',
      completedAt,
      failure,
    },
    failure,
    partial,
    createdAt: completedAt,
  };
}

function fromAiFailure(failure: ModelFailure): ModelCallFailure {
  return {
    code: failure.code,
    message: failure.message,
    retryable: failure.code !== 'aborted' && failure.code !== 'unknown' && failure.retryable,
    ...(failure.retryAfterMs === undefined ? {} : { retryAfterMs: failure.retryAfterMs }),
  };
}

function isRetryableFailure(failure: ModelCallFailure): boolean {
  return failure.retryable && failure.code !== 'unknown' && failure.code !== 'aborted';
}

function abortedFailure(): ModelCallFailure {
  return {
    code: 'aborted',
    message: 'Model call was aborted.',
    retryable: false,
  };
}

function timeoutFailure(): ModelCallFailure {
  return {
    code: 'timeout',
    message: 'Model call timed out.',
    retryable: true,
  };
}

function invalidResponseFailure(message: string): ModelCallFailure {
  return {
    code: 'invalid_response',
    message,
    retryable: false,
  };
}

function emptyPartial(): ModelCallPartialOutput {
  return { text: '', thinking: '' };
}

function createAttemptInterruption(input: {
  readonly runSignal: AbortSignal;
  readonly timeoutController: AbortController;
  readonly timeoutMs: number;
}): {
  readonly result: Promise<{ readonly type: 'interrupted'; readonly reason: 'abort' | 'timeout' }>;
  readonly dispose: () => void;
} {
  let settled = false;
  let resolve!: (
    result: { readonly type: 'interrupted'; readonly reason: 'abort' | 'timeout' },
  ) => void;
  const result = new Promise<{ readonly type: 'interrupted'; readonly reason: 'abort' | 'timeout' }>(
    (complete) => {
      resolve = complete;
    },
  );
  const finish = (reason: 'abort' | 'timeout') => {
    if (settled) return;
    settled = true;
    resolve({ type: 'interrupted', reason });
  };
  const onAbort = () => finish('abort');
  input.runSignal.addEventListener('abort', onAbort, { once: true });
  const timeout = setTimeout(() => {
    finish('timeout');
    input.timeoutController.abort();
  }, input.timeoutMs);

  if (input.runSignal.aborted) finish('abort');

  return {
    result,
    dispose: () => {
      clearTimeout(timeout);
      input.runSignal.removeEventListener('abort', onAbort);
    },
  };
}

function closeIterator(iterator: AsyncIterator<AssistantMessageEvent>): void {
  if (!iterator.return) return;
  try {
    void Promise.resolve(iterator.return()).catch(() => undefined);
  } catch {
    // The provider has already been aborted; iterator cleanup cannot change ModelCall outcome.
  }
}

function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  if (delayMs <= 0 || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timeout);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}
