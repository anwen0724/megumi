/*
 * Executes one Engine-owned ModelCall through Models with isolated retry buffers.
 */
import {
  isContextOverflow,
  isRetryableAssistantError,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Context,
  type Model,
  type Models,
  type ModelsSimpleStreamOptions,
  type ToolCall,
} from '@megumi/ai';
import type { EngineClock } from './engine';
import type { EnginePolicy } from './engine-policy';
import { createInterruption } from './timeout-utils';

export type ModelCallStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface ModelCallFailure {
  readonly code:
    | 'aborted'
    | 'timeout'
    | 'empty_response'
    | 'output_truncated'
    | 'invalid_response'
    | 'provider_error';
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

/** A recoverable Context Overflow: neither a normal completion nor a retryable failure. */
interface OverflowAttempt {
  readonly status: 'overflow';
  readonly message: AssistantMessage;
}

type AttemptOutcome = SuccessfulAttempt | FailedAttempt | OverflowAttempt;
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
      // A normal-looking completion can still report usage that fills the
      // window (silent usage overflow): route it to the Overflow recovery.
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

    if (outcome.status === 'overflow') {
      // Overflow never becomes a normal failure and never consumes a retry
      // attempt. The Engine coordinates one compaction recovery.
      yield {
        type: 'context_overflow',
        modelCallId: request.modelCallId,
        attemptNumber,
        message: outcome.message,
        createdAt: request.clock.now(),
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
  const interruption = createInterruption({
    runSignal: request.signal,
    timeoutController,
    timeoutMs: request.policy.modelCallTimeoutMs,
    abortReason: 'abort',
  });
  const fail = (failure: ModelCallFailure): FailedAttempt => ({
    status: 'failed',
    failure,
    partial: { text: partialText, thinking: partialThinking },
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
        // The run root signal or the model call timeout aborts the attempt
        // stream; the adapter settles it into a terminal event on its own.
        if (outcome.reason === 'timeout') {
          return fail(timeoutFailure());
        }
        return fail(abortedFailure());
      }

      if (outcome.type === 'thrown') {
        return fail(failureFromThrownError(request.signal.aborted ? 'aborted' : 'error', outcome.error));
      }

      if (outcome.value.done) {
        return fail(invalidResponseFailure('Model stream ended without a terminal event.'));
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
        // A provider error whose full message matches the overflow signature is a
        // recoverable Context Overflow, not an ordinary ModelCall failure: the
        // Engine compacts once and retries on the same logical ModelCall.
        if (isContextOverflow(event.error, request.model.contextWindow)) {
          return { status: 'overflow', message: event.error };
        }
        return fail(failureFromErrorEvent(event.reason, event.error));
      }
      if (event.type === 'done') {
        // Silent length-stop overflow (input filled the window, nothing left to
        // generate) must reach the Overflow recovery instead of being mapped to
        // an ordinary output_truncated failure.
        if (event.reason === 'length' && isContextOverflow(event.message, request.model.contextWindow)) {
          return { status: 'overflow', message: event.message };
        }
        const response = validateCompletedModelResponse(
          request.modelCallId,
          event.reason,
          event.message,
        );
        if (response.status === 'invalid') {
          return fail(response.failure);
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
    return fail(failureFromThrownError(request.signal.aborted ? 'aborted' : 'error', error));
  } finally {
    interruption.dispose();
  }
}

export function validateCompletedModelResponse(
  modelCallId: string,
  doneReason: Extract<AssistantMessage['stopReason'], 'stop' | 'length' | 'toolUse' | 'deferred'>,
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

  if (doneReason === 'deferred') {
    return { status: 'invalid', failure: invalidResponseFailure('Deferred responses are not supported.') };
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

/**
 * Maps a terminal error AssistantMessage to an Engine ModelCall failure. The
 * terminal message is the authority: retryability comes from the AI package's
 * classifier, and the Engine no longer re-classifies provider error text.
 */
function failureFromErrorEvent(reason: 'aborted' | 'error', message: AssistantMessage): ModelCallFailure {
  if (reason === 'aborted' || message.stopReason === 'aborted') return abortedFailure();
  return {
    code: 'provider_error',
    message: message.errorMessage ?? 'Model call failed.',
    retryable: isRetryableAssistantError(message),
  };
}

/** Maps an unexpected stream throw (an adapter contract violation) to a failure. */
function failureFromThrownError(reason: 'aborted' | 'error', error: unknown): ModelCallFailure {
  if (reason === 'aborted') return abortedFailure();
  const message: AssistantMessage = {
    role: 'assistant',
    content: [],
    api: 'unknown',
    provider: 'unknown',
    model: 'unknown',
    usage: ZERO_USAGE,
    stopReason: 'error',
    errorMessage: error instanceof Error ? error.message : String(error),
    timestamp: Date.now(),
  };
  return failureFromErrorEvent('error', message);
}

const ZERO_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
} as const;

function isRetryableFailure(failure: ModelCallFailure): boolean {
  return failure.retryable && failure.code !== 'aborted';
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
