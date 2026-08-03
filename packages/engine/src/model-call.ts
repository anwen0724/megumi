/*
 * Executes one Engine-owned ModelCall through Models with isolated retry buffers.
 */
import {
  classifyModelFailure,
  isContextOverflow,
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
  readonly code:
    | ModelFailure['code']
    | 'timeout'
    | 'empty_response'
    | 'output_truncated'
    | 'invalid_response'
    | 'termination_unconfirmed';
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
      readonly type: 'context_overflow';
      readonly modelCallId: string;
      readonly attemptNumber: number;
      readonly message: AssistantMessage;
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
  /** Attempt numbering continues across an Overflow recovery on the same logical ModelCall. */
  readonly startAttemptNumber?: number;
  readonly signal: AbortSignal;
  readonly policy: Pick<
    EnginePolicy,
    | 'maxModelCallAttempts'
    | 'modelCallTimeoutMs'
    | 'modelCallTerminationTimeoutMs'
    | 'modelRetryDelayMs'
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

  const firstAttempt = request.startAttemptNumber ?? 1;
  // An Overflow recovery continues the attempt numbering without consuming the
  // normal retry budget: the limit is extended by the recovery offset.
  const maxAttempts = request.policy.maxModelCallAttempts + firstAttempt - 1;
  const wait = request.wait ?? waitForRetry;

  for (let attemptNumber = firstAttempt; attemptNumber <= maxAttempts; attemptNumber += 1) {
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
      // Overflow is its own outcome: it never becomes a normal failure and never
      // consumes a retry attempt. The Engine coordinates one compaction recovery.
      if (isContextOverflow(outcome.message, request.model.contextWindow)) {
        yield {
          type: 'context_overflow',
          modelCallId: request.modelCallId,
          attemptNumber,
          message: outcome.message,
          createdAt: completedAt,
        };
        return;
      }
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
        if (outcome.reason === 'timeout') {
          const settled = await waitForModelCallSettlement(
            stream,
            request.policy.modelCallTerminationTimeoutMs,
          );
          return {
            status: 'failed',
            failure: settled ? timeoutFailure() : terminationUnconfirmedFailure(),
            partial: { text: partialText, thinking: partialThinking },
          };
        }
        return {
          status: 'failed',
          failure: abortedFailure(),
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
        const response = validateCompletedModelResponse(
          request.modelCallId,
          event.reason,
          event.message,
        );
        if (response.status === 'invalid') {
          return {
            status: 'failed',
            failure: response.failure,
            partial: { text: partialText, thinking: partialThinking },
          };
        }
        return {
          status: 'completed',
          message: event.message,
          toolCalls: response.toolCalls,
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

export function validateCompletedModelResponse(
  modelCallId: string,
  doneReason: Extract<AssistantMessage['stopReason'], 'stop' | 'length' | 'toolUse'>,
  message: AssistantMessage,
):
  | { readonly status: 'valid'; readonly toolCalls: readonly CompletedModelToolCall[] }
  | { readonly status: 'invalid'; readonly failure: ModelCallFailure } {
  if (message.stopReason !== doneReason) {
    return {
      status: 'invalid',
      failure: invalidResponseFailure('Model terminal reason did not match the final message.'),
    };
  }

  if (doneReason === 'length') {
    return { status: 'invalid', failure: outputTruncatedFailure() };
  }

  const calls = message.content.filter((block): block is ToolCall => block.type === 'toolCall');
  if (doneReason === 'stop') {
    if (calls.length > 0) {
      return {
        status: 'invalid',
        failure: invalidResponseFailure('Model stopped normally but included a ToolCall.'),
      };
    }
    if (!hasVisibleAssistantText(message)) {
      return { status: 'invalid', failure: emptyResponseFailure() };
    }
    return { status: 'valid', toolCalls: [] };
  }

  if (calls.length === 0) {
    return {
      status: 'invalid',
      failure: invalidResponseFailure('Model reported Tool use without a ToolCall.'),
    };
  }

  const seenIds = new Set<string>();
  const toolCalls: CompletedModelToolCall[] = [];

  for (const [callOrder, call] of calls.entries()) {
    if (
      !call.id
      || !call.name
      || seenIds.has(call.id)
      || !call.arguments
      || typeof call.arguments !== 'object'
      || Array.isArray(call.arguments)
    ) {
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

export function hasVisibleAssistantText(message: AssistantMessage): boolean {
  return message.content.some((block) => block.type === 'text' && block.text.trim().length > 0);
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

function terminationUnconfirmedFailure(): ModelCallFailure {
  return {
    code: 'termination_unconfirmed',
    message: 'Model call termination could not be confirmed.',
    retryable: false,
  };
}

function emptyResponseFailure(): ModelCallFailure {
  return {
    code: 'empty_response',
    message: 'Model returned no visible response.',
    retryable: true,
  };
}

function outputTruncatedFailure(): ModelCallFailure {
  return {
    code: 'output_truncated',
    message: 'Model output was truncated before completion.',
    retryable: false,
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

export async function waitForModelCallSettlement(
  stream: { waitForSettlement(): Promise<void> },
  timeoutMs: number,
): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      stream.waitForSettlement().then(() => true),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
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
