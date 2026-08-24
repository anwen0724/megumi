/* Runs one logical ModelCall, including streaming, retry, timeout, and overflow recovery. */
import {
  isContextOverflow,
  isRetryableAssistantError,
  type AssistantMessage,
  type AssistantMessageEventStream,
} from '@megumi/ai';
import type {
  AgentContext,
  AgentContextProvider,
  AgentError,
  AgentEventSink,
  AgentExecutionReporter,
  AgentStreamFunction,
  AgentToolCall,
  ModelCallPolicy,
} from './types';

export interface RunModelCallInput {
  readonly model: import('@megumi/ai').Model<import('@megumi/ai').Api>;
  readonly thinkingLevel: import('@megumi/ai').ThinkingLevel;
  readonly context: AgentContext;
  readonly stream: AgentStreamFunction;
  readonly contextProvider?: AgentContextProvider;
  readonly signal: AbortSignal;
  readonly policy: ModelCallPolicy;
  readonly executionId: string;
  readonly turn: number;
  readonly report: AgentExecutionReporter;
  readonly emit: AgentEventSink;
}

export type ModelCallResult =
  | {
      readonly status: 'completed';
      readonly message: AssistantMessage;
      readonly toolCalls: readonly AgentToolCall[];
      readonly context: AgentContext;
    }
  | { readonly status: 'failed'; readonly error: AgentError; readonly partial?: AssistantMessage }
  | { readonly status: 'cancelled'; readonly partial?: AssistantMessage };

type AttemptResult =
  | { readonly status: 'completed'; readonly message: AssistantMessage }
  | { readonly status: 'failed'; readonly message?: AssistantMessage; readonly error: AgentError }
  | { readonly status: 'cancelled'; readonly partial?: AssistantMessage };

export async function runModelCall(input: RunModelCallInput): Promise<ModelCallResult> {
  let context = input.context;
  let attempt = 1;
  let overflowRecoveries = 0;
  let lifecycleStarted = false;
  let latestPartial: AssistantMessage | undefined;
  const projectMessage = async (message: AssistantMessage) => {
    latestPartial = message;
    if (!lifecycleStarted) {
      lifecycleStarted = true;
      await input.emit({ type: 'message_start', executionId: input.executionId, message });
      return;
    }
    await input.emit({ type: 'message_update', executionId: input.executionId, message });
  };

  const emitAttemptEnded = async (
    outcome: 'succeeded' | 'retrying' | 'failed' | 'cancelled',
    error?: AgentError,
  ): Promise<void> => {
    await input.emit({
      type: 'model_call_attempt_ended',
      executionId: input.executionId,
      turn: input.turn,
      attempt,
      outcome,
      ...(error ? { error } : {}),
    });
  };

  while (!input.signal.aborted) {
    // The Agent projects the attempt into its state before the attempt fact
    // publishes, so listeners always read a consistent snapshot.
    await input.report({ attempt });
    await input.emit({
      type: 'model_call_attempt_started',
      executionId: input.executionId,
      turn: input.turn,
      attempt,
    });
    const result = await runAttempt(input, context, projectMessage);
    if (result.status === 'cancelled') {
      await emitAttemptEnded('cancelled');
      const partial = result.partial ?? latestPartial;
      return {
        status: 'cancelled',
        ...(partial ? { partial } : {}),
      };
    }

    if (result.message && isContextOverflow(result.message, input.model.contextWindow)) {
      if (
        overflowRecoveries >= input.policy.maxContextOverflowRecoveries
        || !input.contextProvider?.recoverOverflow
      ) {
        const error = agentError(
          'context_failed',
          'Model context overflow could not be recovered.',
          false,
          result.message,
        );
        await emitAttemptEnded('failed', error);
        return {
          status: 'failed',
          error,
          ...(latestPartial ? { partial: latestPartial } : {}),
        };
      }
      // Context Overflow recovery is one logical ModelCall moving through
      // preparing_context before the next real attempt starts.
      await emitAttemptEnded('retrying');
      await input.report({ phase: 'preparing_context' });
      const recovered = await input.contextProvider.recoverOverflow({
        model: input.model,
        context,
        signal: input.signal,
        attempt: overflowRecoveries + 1,
      });
      if (recovered.status === 'cancelled' || input.signal.aborted) {
        return { status: 'cancelled', ...(result.message ? { partial: result.message } : {}) };
      }
      if (recovered.status === 'failed') {
        return {
          status: 'failed',
          error: recovered.error,
          ...(latestPartial ? { partial: latestPartial } : {}),
        };
      }
      context = recovered.context;
      overflowRecoveries += 1;
      await input.report({ phase: 'calling_model' });
      attempt += 1;
      continue;
    }

    if (result.status === 'completed') {
      const validated = validateMessage(result.message);
      if (validated.status === 'valid') {
        await emitAttemptEnded('succeeded');
        return {
          status: 'completed',
          message: result.message,
          toolCalls: validated.toolCalls,
          context,
        };
      }
      const error = agentError('model_call_failed', validated.message, validated.retryable, result.message);
      if (validated.retryable && attempt < input.policy.maxModelCallAttempts) {
        await emitAttemptEnded('retrying', error);
        await waitForRetry(input.policy.modelRetryDelayMs, input.signal);
        attempt += 1;
        continue;
      }
      await emitAttemptEnded('failed', error);
      return {
        status: 'failed',
        error,
        ...(latestPartial ? { partial: latestPartial } : {}),
      };
    }

    if (result.error.retryable && attempt < input.policy.maxModelCallAttempts) {
      await emitAttemptEnded('retrying', result.error);
      await waitForRetry(input.policy.modelRetryDelayMs, input.signal);
      attempt += 1;
      continue;
    }
    await emitAttemptEnded('failed', result.error);
    return {
      status: 'failed',
      error: result.error,
      ...(latestPartial ? { partial: latestPartial } : {}),
    };
  }

  return { status: 'cancelled' };
}

async function runAttempt(
  input: RunModelCallInput,
  context: AgentContext,
  projectMessage: (message: AssistantMessage) => Promise<void>,
): Promise<AttemptResult> {
  const timeoutController = new AbortController();
  const signal = AbortSignal.any([input.signal, timeoutController.signal]);
  const timeout = setTimeout(() => timeoutController.abort(), input.policy.modelCallTimeoutMs);
  let partial: AssistantMessage | undefined;
  let terminal: AssistantMessage | undefined;
  try {
    const stream = await input.stream(
      input.model,
      {
        systemPrompt: context.systemPrompt,
        messages: [...context.messages],
        tools: [...context.tools],
      },
      {
        reasoning: input.thinkingLevel,
        signal,
        timeoutMs: input.policy.modelCallTimeoutMs,
      },
    );
    terminal = await consumeStream(stream, async (message) => {
      partial = message;
      await projectMessage(message);
    }, signal);
  } catch (error) {
    if (signal.aborted) return { status: 'cancelled', ...(partial ? { partial } : {}) };
    return {
      status: 'failed',
      error: agentError(
        'model_call_failed',
        error instanceof Error ? error.message : 'Model stream failed.',
        false,
        error,
      ),
    };
  } finally {
    clearTimeout(timeout);
  }

  if (!terminal && input.signal.aborted) {
    return { status: 'cancelled', ...(partial ? { partial } : {}) };
  }
  if (!terminal && timeoutController.signal.aborted) {
    return {
      status: 'failed',
      error: agentError('model_call_failed', 'Model call timed out.', true),
    };
  }
  if (!terminal) {
    return {
      status: 'failed',
      error: agentError('model_call_failed', 'Model stream ended without a terminal event.', false),
    };
  }
  if (terminal.stopReason === 'aborted' || signal.aborted) {
    return { status: 'cancelled', partial: terminal };
  }
  if (terminal.stopReason === 'error') {
    return {
      status: 'failed',
      message: terminal,
      error: agentError(
        'model_call_failed',
        terminal.errorMessage ?? 'Model call failed.',
        isRetryableAssistantError(terminal),
        terminal,
      ),
    };
  }
  return { status: 'completed', message: terminal };
}

async function consumeStream(
  stream: AssistantMessageEventStream,
  onProjection: (message: AssistantMessage) => Promise<void>,
  signal: AbortSignal,
): Promise<AssistantMessage | undefined> {
  const iterator = stream[Symbol.asyncIterator]();
  let terminal: AssistantMessage | undefined;
  try {
    while (!signal.aborted) {
      const next = await nextWithAbort(iterator, signal);
      if (next.done) break;
      const event = next.value;
      if (event.type === 'done') terminal = event.message;
      else if (event.type === 'error') terminal = event.error;
      else await onProjection(event.partial);
    }
  } finally {
    const returned = iterator.return?.();
    if (returned) {
      if (signal.aborted) void returned.catch(() => undefined);
      else await returned;
    }
  }
  return terminal;
}

async function nextWithAbort<T>(
  iterator: AsyncIterator<T>,
  signal: AbortSignal,
): Promise<IteratorResult<T>> {
  if (signal.aborted) return { done: true, value: undefined };
  return await new Promise<IteratorResult<T>>((resolve, reject) => {
    let settled = false;
    const settle = (result: IteratorResult<T>) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const onAbort = () => settle({ done: true, value: undefined });
    signal.addEventListener('abort', onAbort, { once: true });
    void iterator.next().then(settle, (error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      reject(error);
    });
    if (signal.aborted) onAbort();
  });
}

function validateMessage(message: AssistantMessage):
  | { readonly status: 'valid'; readonly toolCalls: readonly AgentToolCall[] }
  | { readonly status: 'invalid'; readonly message: string; readonly retryable: boolean } {
  if (message.stopReason === 'length') {
    return { status: 'invalid', message: 'Model output was truncated before completion.', retryable: false };
  }
  if (message.stopReason === 'deferred' || message.stopReason === 'pending') {
    return { status: 'invalid', message: 'Model returned an unsupported terminal response.', retryable: false };
  }
  const calls = message.content.filter((block): block is AgentToolCall => block.type === 'toolCall');
  if (message.stopReason === 'stop') {
    if (calls.length > 0) {
      return { status: 'invalid', message: 'Model stopped normally but included a ToolCall.', retryable: false };
    }
    const visible = message.content.some((block) => block.type === 'text' && block.text.trim().length > 0);
    return visible
      ? { status: 'valid', toolCalls: [] }
      : { status: 'invalid', message: 'Model returned no visible response.', retryable: true };
  }
  if (message.stopReason !== 'toolUse' || calls.length === 0) {
    return { status: 'invalid', message: 'Model reported Tool use without a ToolCall.', retryable: false };
  }
  const ids = new Set<string>();
  for (const call of calls) {
    if (!call.id || !call.name || ids.has(call.id) || !isRecord(call.arguments)) {
      return { status: 'invalid', message: 'Model response contained an invalid ToolCall.', retryable: false };
    }
    ids.add(call.id);
  }
  return { status: 'valid', toolCalls: calls };
}

async function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  if (delayMs <= 0 || signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, delayMs);
    signal.addEventListener('abort', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

function agentError(
  code: AgentError['code'],
  message: string,
  retryable: boolean,
  cause?: unknown,
): AgentError {
  return { code, message, retryable, ...(cause === undefined ? {} : { cause }) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
