/*
 * Consumes the configured AI service's stream and projects model output for one turn.
 */
import {
  captureContent,
  createModelCapture,
  observeModelCapture,
  observeOperation,
} from '../diagnostics';
import { isContextOverflow, isRetryableAssistantError, type AssistantMessage } from '@megumi/ai';
import { setTimeout as delay } from 'node:timers/promises';
import type { PreparedContext } from '../context/context-contracts';
import { AgentFailure, type RunExecution } from './run-agent';

/** Returns a completed model message after the provider stream has closed. */
export async function callModel(
  run: RunExecution,
  context: PreparedContext,
  messageId: string,
  turn: number,
  prepare: () => Promise<PreparedContext>,
  recoverOverflow: (context: PreparedContext) => Promise<PreparedContext>,
): Promise<{ readonly message: AssistantMessage; readonly context: PreparedContext }> {
  const { policy } = run.request.config;
  let overflowRecoveries = 0;
  for (let attempt = 1; ; attempt += 1) {
    run.signal.throwIfAborted();
    run.progress({ phase: 'calling_model', attempt });
    run.emit({ type: 'model_attempt', runId: run.runId, turn, attempt, outcome: 'started' });
    try {
      const modelCallId = `${messageId}:${attempt}`;
      const message = await observeOperation(
        run.diagnostics,
        { runId: run.runId, name: 'model.call', modelCallId },
        () => callAttempt(run, context, messageId, modelCallId),
        (result) =>
          result.stopReason === 'error'
            ? {
                status: 'error',
                code: 'MODEL_CALL_FAILED',
                message: result.errorMessage ?? 'Model request failed.',
              }
            : { status: result.stopReason === 'aborted' ? 'cancelled' : 'ok' },
      );
      if (run.signal.aborted) return { message, context };
      if (isContextOverflow(message, run.request.config.model.contextWindow)) {
        if (overflowRecoveries >= policy.maxContextOverflowRecoveries) {
          throw new AgentFailure('compacting_context', {
            code: 'CONTEXT_OVERFLOW',
            message: 'Context overflow recovery limit reached.',
            retryable: false,
          });
        }
        overflowRecoveries += 1;
        run.emit({ type: 'model_attempt', runId: run.runId, turn, attempt, outcome: 'retrying' });
        context = await recoverOverflow(context);
        continue;
      }
      if (message.stopReason === 'error') {
        throw new AgentFailure('calling_model', {
          code: 'MODEL_CALL_FAILED',
          message: message.errorMessage ?? 'Model request failed.',
          retryable: isRetryableAssistantError(message),
        });
      }
      validateMessage(message);
      run.emit({ type: 'model_attempt', runId: run.runId, turn, attempt, outcome: 'completed' });
      return { message, context };
    } catch (error) {
      const retry =
        error instanceof AgentFailure &&
        error.detail.retryable &&
        attempt < policy.maxModelCallAttempts &&
        !run.signal.aborted;
      run.emit({
        type: 'model_attempt',
        runId: run.runId,
        turn,
        attempt,
        outcome: retry ? 'retrying' : 'failed',
      });
      if (!retry) throw error;
      await delay(policy.modelRetryDelayMs, undefined, { signal: run.signal });
      run.progress({ phase: 'preparing_context' });
      context = await prepare();
    }
  }
}

/** Timeout requests provider cancellation; stream closure is still awaited. */
async function callAttempt(
  run: RunExecution,
  context: PreparedContext,
  messageId: string,
  modelCallId: string,
): Promise<AssistantMessage> {
  const { model, policy } = run.request.config;
  const timeout = new AbortController();
  const signal = AbortSignal.any([run.signal, timeout.signal]);
  const timer = setTimeout(() => timeout.abort(), policy.modelCallTimeoutMs);
  const capture = createModelCapture(run.diagnostics, {
    runId: run.runId,
    name: 'model.call',
    modelCallId,
  });
  captureContent(run.diagnostics, {
    runId: run.runId,
    modelCallId,
    kind: 'model.request',
    value: { model, context },
  });
  let message: AssistantMessage | undefined;
  let partial: AssistantMessage | undefined;
  try {
    const stream = run.ai.streamSimple(
      model,
      {
        systemPrompt: context.systemPrompt,
        messages: [...context.messages],
        tools: [...context.tools],
      },
      {
        ...capture?.options,
        signal,
        timeoutMs: policy.modelCallTimeoutMs,
        maxRetries: policy.providerRequestMaxRetries,
        maxRetryDelayMs: policy.providerRequestMaxRetryDelayMs,
      },
    );
    for await (const event of stream) {
      observeModelCapture(run.diagnostics, run.runId, () => capture?.observe(event));
      if (event.type === 'done') message = event.message;
      else if (event.type === 'error') message = event.error;
      else {
        partial = structuredClone(event.partial);
        run.progress({ streamingMessage: structuredClone(event.partial) });
        run.emit({ type: 'model_update', runId: run.runId, messageId, message: event.partial });
      }
    }
  } catch (cause) {
    if (signal.aborted) {
      if (run.signal.aborted && partial) return interruptedMessage(partial);
      run.signal.throwIfAborted();
      throw new AgentFailure(
        'calling_model',
        { code: 'MODEL_TIMEOUT', message: 'Model call timed out.', retryable: true },
        { cause },
      );
    }
    throw new AgentFailure(
      'calling_model',
      { code: 'MODEL_CALL_FAILED', message: 'Model stream failed.', retryable: false },
      { cause },
    );
  } finally {
    clearTimeout(timer);
    observeModelCapture(run.diagnostics, run.runId, () => capture?.complete(message));
    captureContent(run.diagnostics, {
      runId: run.runId,
      modelCallId,
      kind: 'model.response',
      value: message,
    });
  }
  const received = message ?? partial;
  if (run.signal.aborted && received) return interruptedMessage(received);
  run.signal.throwIfAborted();
  if (timeout.signal.aborted) {
    throw new AgentFailure('calling_model', {
      code: 'MODEL_TIMEOUT',
      message: 'Model call timed out.',
      retryable: true,
    });
  }
  if (!message || message.stopReason === 'aborted') {
    throw new AgentFailure('calling_model', {
      code: 'MODEL_CALL_FAILED',
      message: 'Model call did not complete.',
      retryable: false,
    });
  }
  return message;
}

/** Incomplete tool arguments are never admitted as executable calls. */
function interruptedMessage(message: AssistantMessage): AssistantMessage {
  return {
    ...message,
    stopReason: 'aborted',
    content: message.content.filter((block) => block.type !== 'toolCall'),
  };
}

/** Checks provider protocol before executing calls or treating the response as final. */
function validateMessage(message: AssistantMessage): void {
  const calls = message.content.filter((block) => block.type === 'toolCall');
  if (message.stopReason === 'stop' && !calls.length) {
    if (message.content.some((block) => block.type === 'text' && block.text.trim())) return;
    throw new AgentFailure('calling_model', {
      code: 'MODEL_CALL_FAILED',
      message: 'Model returned no visible response.',
      retryable: true,
    });
  }
  const ids = new Set<string>();
  if (
    message.stopReason === 'toolUse' &&
    calls.length &&
    calls.every((call) => {
      if (
        !call.id ||
        !call.name ||
        ids.has(call.id) ||
        !call.arguments ||
        typeof call.arguments !== 'object' ||
        Array.isArray(call.arguments)
      )
        return false;
      ids.add(call.id);
      return true;
    })
  )
    return;
  throw new AgentFailure('calling_model', {
    code: 'MODEL_PROTOCOL_ERROR',
    message: 'Model returned an incomplete or invalid response.',
    retryable: false,
  });
}
