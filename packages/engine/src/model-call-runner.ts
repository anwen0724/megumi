/*
 * Completes the one logical ModelCall the Agent Loop decided to run: it
 * consumes the AI stream, validates stop reasons and ToolCall protocol,
 * isolates attempts, executes ModelCall Retry and Context Overflow recovery
 * through the loop-provided Prompt rebuild callback, and publishes the model
 * stream and retry facts. Attempts, retries and stream buffers are internal
 * work data: the runner never reads or writes the Run status, never decides
 * whether the loop continues or the Run ends, and never creates new Turn,
 * Message or ModelCall identities.
 */
import {
  isContextOverflow,
  isRetryableAssistantError,
  type Api,
  type AssistantMessage,
  type Model,
  type Models,
} from '@megumi/ai';
import type { MeasurementUnit } from '@megumi/observability';
import type { EventPayloadByType, EventType } from '@megumi/events';
import type { ContextCompactor, Prompt } from '@megumi/context';
import type { RunClock } from './run';
import type { RunPolicy } from './run-policy';

/** The current logical ModelCall's streamed text/thinking projection. */
export interface ModelCallProjection {
  text: string;
  thinking: string;
}

export interface CompletedToolCall {
  readonly toolCallId: string;
  /** The logical ModelCall that produced this ToolCall. */
  readonly sourceModelCallId: string;
  readonly callOrder: number;
  readonly toolName: string;
  readonly input: unknown;
}

/**
 * A ModelCall failure keeps its owner and stable code; whether the Run ends
 * is the Agent Loop's decision.
 */
export interface ModelCallFailure {
  /** The RunFailure code to use when the Agent Loop terminates the Run. */
  readonly code: 'model_call_failed' | 'context_failed';
  readonly message: string;
  readonly retryable: boolean;
  readonly owner: 'ai' | 'context';
  readonly causeCode: string;
}

export type ModelCallOutcome =
  | {
      readonly status: 'completed';
      readonly message: AssistantMessage;
      readonly toolCalls: readonly CompletedToolCall[];
    }
  | { readonly status: 'failed'; readonly failure: ModelCallFailure }
  | { readonly status: 'cancelled'; readonly partial: { readonly text: string; readonly thinking: string } };

/**
 * A Prompt (re)build result: Context failures keep their original code,
 * message and retryable facts instead of being converted to generic errors.
 */
export type RebuildPromptResult =
  | { readonly status: 'ready'; readonly prompt: Prompt }
  | {
      readonly status: 'failed';
      readonly failure: { readonly code: string; readonly message: string; readonly retryable: boolean };
    };

/** The narrowed Runtime Event publish the runner needs; correlation is fixed by the loop. */
export interface ModelCallEventSource {
  publish<TType extends EventType>(type: TType, payload: EventPayloadByType[TType]): void;
}

/** The narrowed best-effort observation surface the runner needs. */
export interface ModelCallObservation {
  recordLog(input: {
    readonly level: 'info' | 'warn' | 'error';
    readonly event: string;
    readonly attributes?: Record<string, unknown>;
  }): void;
  recordMeasurement(input: {
    readonly name: string;
    readonly value: number;
    readonly unit: MeasurementUnit;
    readonly attributes?: Record<string, unknown>;
  }): void;
}

export interface RunModelCallRequest {
  readonly runId: string;
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly model: Model<Api>;
  readonly modelCallId: string;
  /** The Assistant Message identity the streaming updates are published under. */
  readonly messageId: string;
  readonly prompt: Prompt;
  /**
   * Rebuilds the Prompt after Context Overflow compaction; never re-resolves
   * Tools. A failed rebuild keeps its Context failure facts.
   */
  readonly buildPrompt: () => Promise<RebuildPromptResult>;
  readonly signal: AbortSignal;
  readonly projection: ModelCallProjection;
  readonly events: ModelCallEventSource;
  readonly observation: ModelCallObservation;
  readonly models: Pick<Models, 'streamSimple'>;
  readonly context: Pick<ContextCompactor, 'compact'>;
  readonly policy: Pick<
    RunPolicy,
    | 'maxModelCallAttempts'
    | 'modelCallTimeoutMs'
    | 'modelRetryDelayMs'
    | 'maxContextOverflowRecoveries'
    | 'providerRequestMaxRetries'
    | 'providerRequestMaxRetryDelayMs'
  >;
  readonly clock: RunClock;
}

/**
 * Runs one logical ModelCall: all attempts, retries and Context Overflow
 * recoveries stay inside this call with the same modelCallId, Turn and
 * Assistant Message identity.
 */
export async function runModelCall(
  request: RunModelCallRequest,
): Promise<ModelCallOutcome> {
  let prompt = request.prompt;
  let attemptNumber = 1;
  let overflowRecoveries = 0;
  const retriedAttempts: number[] = [];

  /** Clears the projected text/thinking snapshots before a recoverable attempt. */
  const resetProjection = (): void => {
    request.projection.text = '';
    request.projection.thinking = '';
    request.events.publish('message.update', {
      role: 'assistant',
      messageId: request.messageId,
      content: '',
    });
    request.events.publish('message.thinking.update', {
      messageId: request.messageId,
      thinking: '',
    });
    request.observation.recordLog({
      level: 'info',
      event: 'model.call.stream_reset',
      attributes: { modelCallId: request.modelCallId, attemptNumber },
    });
  };

  const recoverOverflow = async (): Promise<ModelCallOutcome | 'recovered'> => {
    // A recoverable stream reset clears the projected text and thinking before
    // the next attempt; the same Turn, Message and ModelCall identities stay.
    resetProjection();
    const compacted = await request.context.compact({
      sessionId: request.sessionId,
      workspaceId: request.workspaceId,
      model: request.model,
      trigger: 'overflow',
      // The current ModelCall Tool Definitions are already resolved; compaction
      // must not re-resolve them and the bus was injected at Context creation.
      tools: prompt.tools,
      signal: request.signal,
    });
    if (compacted.status !== 'compacted') {
      return {
        status: 'failed',
        failure: {
          code: 'context_failed',
          message: compacted.status === 'failed'
            ? compacted.failure.message
            : 'ModelCall overflowed and compaction had nothing to compact.',
          retryable: false,
          owner: 'context',
          causeCode: compacted.status === 'failed' ? compacted.failure.code : 'compaction_failed',
        },
      };
    }
    if (request.signal.aborted) {
      return {
        status: 'cancelled',
        partial: { text: request.projection.text, thinking: request.projection.thinking },
      };
    }
    try {
      const rebuilt = await request.buildPrompt();
      if (rebuilt.status === 'failed') {
        // A failed rebuild keeps the original Context failure facts; only the
        // Agent Loop decides whether the Run ends.
        return {
          status: 'failed',
          failure: {
            code: 'context_failed',
            message: rebuilt.failure.message,
            retryable: rebuilt.failure.retryable,
            owner: 'context',
            causeCode: rebuilt.failure.code,
          },
        };
      }
      prompt = rebuilt.prompt;
    } catch (error) {
      if (request.signal.aborted) {
        return {
          status: 'cancelled',
          partial: { text: request.projection.text, thinking: request.projection.thinking },
        };
      }
      throw error;
    }
    overflowRecoveries += 1;
    attemptNumber += 1;
    return 'recovered';
  };

  for (;;) {
    if (request.signal.aborted) {
      return {
        status: 'cancelled',
        partial: { text: request.projection.text, thinking: request.projection.thinking },
      };
    }
    const maxAttempts = request.policy.maxModelCallAttempts + overflowRecoveries;
    request.observation.recordMeasurement({
      name: 'model.call.attempt',
      value: attemptNumber,
      unit: 'count',
      attributes: { modelCallId: request.modelCallId },
    });

    const attempt = await runStreamAttempt(request, prompt, attemptNumber);

    if (attempt.status === 'completed') {
      if (isContextOverflow(attempt.message, request.model.contextWindow)) {
        // Compaction recoveries are bounded by the confirmed Run Policy;
        // exhausting them ends the Run instead of compacting again.
        if (overflowRecoveries >= request.policy.maxContextOverflowRecoveries) {
          request.observation.recordMeasurement({
            name: 'model.call.limit',
            value: 1,
            unit: 'count',
            attributes: { modelCallId: request.modelCallId, limitKind: 'overflow_recovery' },
          });
          return {
            status: 'failed',
            failure: {
              code: 'context_failed',
              message: 'ModelCall overflowed the Context Window even after compaction recovery.',
              retryable: false,
              owner: 'context',
              causeCode: 'context_window_exceeded',
            },
          };
        }
        const recovered = await recoverOverflow();
        if (recovered !== 'recovered') return recovered;
        continue;
      }
      const validated = validateCompletedResponse(request.modelCallId, attempt.message);
      if (validated.status === 'invalid') {
        if (validated.failure.retryable && attemptNumber < maxAttempts && !request.signal.aborted) {
          resetProjection();
          retriedAttempts.push(attemptNumber + 1);
          publishRetryStarted(request, attemptNumber + 1, maxAttempts);
          await waitForRetry(request.policy.modelRetryDelayMs, request.signal);
          attemptNumber += 1;
          continue;
        }
        publishRetryFailed(request, retriedAttempts, validated.failure);
        return {
          status: 'failed',
          failure: modelCallFailure('model_call_failed', validated.failure),
        };
      }
      publishRetryCompleted(request, retriedAttempts);
      return {
        status: 'completed',
        message: attempt.message,
        toolCalls: validated.toolCalls,
      };
    }

    if (attempt.status === 'overflow') {
      // Compaction recoveries are bounded by the confirmed Run Policy;
      // exhausting them ends the Run instead of compacting again.
      if (overflowRecoveries >= request.policy.maxContextOverflowRecoveries) {
        request.observation.recordMeasurement({
          name: 'model.call.limit',
          value: 1,
          unit: 'count',
          attributes: { modelCallId: request.modelCallId, limitKind: 'overflow_recovery' },
        });
        return {
          status: 'failed',
          failure: {
            code: 'context_failed',
            message: 'ModelCall overflowed the Context Window even after compaction recovery.',
            retryable: false,
            owner: 'context',
            causeCode: 'context_window_exceeded',
          },
        };
      }
      const recovered = await recoverOverflow();
      if (recovered !== 'recovered') return recovered;
      continue;
    }

    if (attempt.status === 'failed') {
      if (attempt.retryable && attemptNumber < maxAttempts && !request.signal.aborted) {
        resetProjection();
        retriedAttempts.push(attemptNumber + 1);
        publishRetryStarted(request, attemptNumber + 1, maxAttempts);
        await waitForRetry(request.policy.modelRetryDelayMs, request.signal);
        attemptNumber += 1;
        continue;
      }
      request.observation.recordMeasurement({
        name: 'model.call.limit',
        value: 1,
        unit: 'count',
        attributes: { modelCallId: request.modelCallId, limitKind: 'attempt' },
      });
      publishRetryFailed(request, retriedAttempts, {
        code: attempt.failure.code,
        message: attempt.failure.message,
      });
      return { status: 'failed', failure: attempt.failure };
    }

    return { status: 'cancelled', partial: attempt.partial };
  }
}

type AttemptOutcome =
  | { readonly status: 'completed'; readonly message: AssistantMessage }
  | { readonly status: 'overflow'; readonly message: AssistantMessage }
  | { readonly status: 'failed'; readonly failure: ModelCallFailure; readonly retryable: boolean }
  | { readonly status: 'aborted'; readonly partial: { readonly text: string; readonly thinking: string } };

async function runStreamAttempt(
  request: RunModelCallRequest,
  prompt: Prompt,
  attemptNumber: number,
): Promise<AttemptOutcome> {
  const startedAt = request.clock.now();
  let terminal: AssistantMessage | undefined;
  const stream = request.models.streamSimple(request.model, {
    systemPrompt: prompt.systemPrompt,
    messages: [...prompt.messages],
    tools: [...prompt.tools],
  }, {
    signal: request.signal,
    sessionId: request.sessionId,
    timeoutMs: request.policy.modelCallTimeoutMs,
    maxRetries: request.policy.providerRequestMaxRetries,
    maxRetryDelayMs: request.policy.providerRequestMaxRetryDelayMs,
  });

  try {
    for await (const event of stream) {
      if (event.type === 'start') continue;
      if (event.type === 'text_delta' || event.type === 'text_end') {
        const text = contentText(event.partial);
        request.projection.text = text;
        if (request.messageId) {
          // Full snapshot: consumers replace, never merge.
          request.events.publish('message.update', {
            role: 'assistant',
            messageId: request.messageId,
            content: text,
          });
        }
        continue;
      }
      if (event.type === 'thinking_delta' || event.type === 'thinking_end') {
        const thinking = thinkingText(event.partial);
        request.projection.thinking = thinking;
        if (request.messageId) {
          // Full snapshot: consumers replace, never merge.
          request.events.publish('message.thinking.update', {
            messageId: request.messageId,
            thinking,
          });
        }
        continue;
      }
      if (event.type === 'done') {
        terminal = event.message;
        continue;
      }
      if (event.type === 'error') {
        terminal = event.error;
        continue;
      }
    }
  } finally {
    // Every finished attempt records its usage, stop reason and duration to
    // Observability; retried attempts are never dropped.
    if (terminal) {
      const durationMs = Date.parse(request.clock.now()) - Date.parse(startedAt);
      request.observation.recordLog({
        level: 'info',
        event: 'model.call.attempt.finished',
        attributes: {
          modelCallId: request.modelCallId,
          attemptNumber,
          stopReason: terminal.stopReason,
          inputTokens: terminal.usage.input,
          outputTokens: terminal.usage.output,
          durationMs,
        },
      });
      request.observation.recordMeasurement({
        name: 'model.call.usage',
        value: terminal.usage.input + terminal.usage.output,
        unit: 'token',
        attributes: {
          modelCallId: request.modelCallId,
          attemptNumber,
          inputTokens: terminal.usage.input,
          outputTokens: terminal.usage.output,
        },
      });
      request.observation.recordMeasurement({
        name: 'model.call.duration_ms',
        value: durationMs,
        unit: 'ms',
        attributes: { modelCallId: request.modelCallId, attemptNumber },
      });
    }
  }

  if (!terminal) {
    return {
      status: 'failed',
      failure: modelCallFailure('model_call_failed', {
        code: 'invalid_response',
        message: 'Model stream ended without a terminal event.',
        retryable: false,
      }),
      retryable: false,
    };
  }

  if (terminal.stopReason === 'aborted' || request.signal.aborted) {
    return {
      status: 'aborted',
      partial: { text: request.projection.text, thinking: request.projection.thinking },
    };
  }
  if (terminal.stopReason === 'error') {
    if (isContextOverflow(terminal, request.model.contextWindow)) {
      return { status: 'overflow', message: terminal };
    }
    const retryable = isRetryableAssistantError(terminal);
    return {
      status: 'failed',
      failure: {
        code: 'model_call_failed',
        message: terminal.errorMessage ?? 'Model call failed.',
        retryable,
        owner: 'ai',
        causeCode: 'provider_error',
      },
      retryable,
    };
  }
  return { status: 'completed', message: terminal };
}

interface ValidatedResponse {
  readonly status: 'valid';
  readonly toolCalls: readonly CompletedToolCall[];
}

type ValidationFailure = {
  readonly code: 'empty_response' | 'output_truncated' | 'invalid_response';
  readonly message: string;
  readonly retryable: boolean;
};

function validateCompletedResponse(
  modelCallId: string,
  message: AssistantMessage,
): { readonly status: 'valid'; readonly toolCalls: readonly CompletedToolCall[] } | { readonly status: 'invalid'; readonly failure: ValidationFailure } {
  if (message.stopReason === 'length') {
    return {
      status: 'invalid',
      failure: { code: 'output_truncated', message: 'Model output was truncated before completion.', retryable: false },
    };
  }
  if (message.stopReason === 'deferred') {
    return {
      status: 'invalid',
      failure: { code: 'invalid_response', message: 'Deferred responses are not supported.', retryable: false },
    };
  }

  const calls = message.content.filter((block): block is Extract<AssistantMessage['content'][number], { type: 'toolCall' }> => (
    block.type === 'toolCall'
  ));
  if (message.stopReason === 'stop') {
    if (calls.length > 0) {
      return {
        status: 'invalid',
        failure: { code: 'invalid_response', message: 'Model stopped normally but included a ToolCall.', retryable: false },
      };
    }
    if (!hasVisibleAssistantText(message)) {
      return {
        status: 'invalid',
        failure: { code: 'empty_response', message: 'Model returned no visible response.', retryable: true },
      };
    }
    return { status: 'valid', toolCalls: [] };
  }

  if (calls.length === 0) {
    return {
      status: 'invalid',
      failure: { code: 'invalid_response', message: 'Model reported Tool use without a ToolCall.', retryable: false },
    };
  }

  const seenIds = new Set<string>();
  const toolCalls: CompletedToolCall[] = [];
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
        failure: { code: 'invalid_response', message: 'Model response contained an invalid ToolCall identity.', retryable: false },
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

function hasVisibleAssistantText(message: AssistantMessage): boolean {
  return message.content.some((block) => block.type === 'text' && block.text.trim().length > 0);
}

function modelCallFailure(
  code: 'model_call_failed',
  failure: { readonly code: string; readonly message: string; readonly retryable: boolean },
): ModelCallFailure {
  return {
    code,
    message: failure.message,
    retryable: failure.retryable,
    owner: 'ai',
    causeCode: failure.code,
  };
}

function publishRetryStarted(
  request: RunModelCallRequest,
  nextAttemptNumber: number,
  maxAttempts: number,
): void {
  request.observation.recordLog({
    level: 'info',
    event: 'model.call.retry.scheduled',
    attributes: { nextAttemptNumber, maxAttempts },
  });
  request.observation.recordMeasurement({
    name: 'model.call.retry',
    value: 1,
    unit: 'count',
    attributes: { modelCallId: request.modelCallId, nextAttemptNumber },
  });
  request.events.publish('turn.retry.started', {
    attemptNumber: nextAttemptNumber,
    retryKind: 'model_call',
  });
}

function publishRetryCompleted(
  request: RunModelCallRequest,
  retriedAttempts: readonly number[],
): void {
  for (const attemptNumber of retriedAttempts) {
    request.observation.recordLog({
      level: 'info',
      event: 'model.call.retry.completed',
      attributes: { retryAttemptNumber: attemptNumber },
    });
    request.events.publish('turn.retry.completed', { attemptNumber });
  }
}

function publishRetryFailed(
  request: RunModelCallRequest,
  retriedAttempts: readonly number[],
  failure: { readonly code?: string; readonly message: string },
): void {
  for (const attemptNumber of retriedAttempts) {
    request.observation.recordLog({
      level: 'warn',
      event: 'model.call.retry.failed',
      attributes: { retryAttemptNumber: attemptNumber },
    });
    request.events.publish('turn.retry.failed', {
      attemptNumber,
      error: { message: failure.message, ...(failure.code ? { code: failure.code } : {}) },
    });
  }
}

async function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  if (delayMs <= 0 || signal.aborted) return;
  await new Promise<void>((resolve) => {
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

function contentText(message: AssistantMessage): string {
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

function thinkingText(message: AssistantMessage): string {
  return message.content
    .filter((block) => block.type === 'thinking')
    .map((block) => block.thinking)
    .join('');
}
