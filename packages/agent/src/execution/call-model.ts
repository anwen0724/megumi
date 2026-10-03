/*
 * Consumes the configured AI service's stream and projects model output for one turn.
 */
import { setTimeout as delay } from 'node:timers/promises';
import { isRetryableAssistantError, type AssistantMessage } from '@megumi/ai';
import type { PreparedContext } from '../context/context-contracts';
import { AgentFailure, type RunExecution } from './run-agent';

/** Returns a completed model message after the provider stream has closed. */
export async function callModel(
  run: RunExecution, context: PreparedContext, messageId: string, turn: number,
  prepare: () => Promise<PreparedContext>,
): Promise<AssistantMessage> {
  const { policy } = run.request.config;
  for (let attempt = 1; ; attempt += 1) {
    run.signal.throwIfAborted();
    run.progress({ phase: 'calling_model', attempt });
    run.emit({ type: 'model_attempt', runId: run.runId, turn, attempt, outcome: 'started' });
    try {
      const message = await callAttempt(run, context, messageId);
      if (message.stopReason === 'error') {
        throw new AgentFailure('calling_model', {
          code: 'MODEL_CALL_FAILED', message: 'Model request failed.',
          retryable: isRetryableAssistantError(message),
        });
      }
      validateMessage(message);
      run.emit({ type: 'model_attempt', runId: run.runId, turn, attempt, outcome: 'completed' });
      return message;
    } catch (error) {
      const retry = error instanceof AgentFailure && error.detail.retryable
        && attempt < policy.maxModelCallAttempts && !run.signal.aborted;
      run.emit({ type: 'model_attempt', runId: run.runId, turn, attempt, outcome: retry ? 'retrying' : 'failed' });
      if (!retry) throw error;
      await delay(policy.modelRetryDelayMs, undefined, { signal: run.signal });
      run.progress({ phase: 'preparing_context' });
      context = await prepare();
    }
  }
}

/** Timeout requests provider cancellation; stream closure is still awaited. */
async function callAttempt(run: RunExecution, context: PreparedContext, messageId: string): Promise<AssistantMessage> {
  const { model, policy } = run.request.config;
  const timeout = new AbortController();
  const signal = AbortSignal.any([run.signal, timeout.signal]);
  const timer = setTimeout(() => timeout.abort(), policy.modelCallTimeoutMs);
  let message: AssistantMessage | undefined;
  try {
    const stream = run.ai.streamSimple(model, {
      systemPrompt: context.systemPrompt, messages: [...context.messages], tools: [...context.tools],
    }, {
      signal, timeoutMs: policy.modelCallTimeoutMs,
      maxRetries: policy.providerRequestMaxRetries, maxRetryDelayMs: policy.providerRequestMaxRetryDelayMs,
    });
    for await (const event of stream) {
      if (event.type === 'done') message = event.message;
      else if (event.type === 'error') message = event.error;
      else {
        run.progress({ streamingMessage: structuredClone(event.partial) });
        run.emit({ type: 'model_update', runId: run.runId, messageId, message: event.partial });
      }
    }
  } catch (cause) {
    if (signal.aborted) {
      run.signal.throwIfAborted();
      throw new AgentFailure('calling_model', { code: 'MODEL_TIMEOUT', message: 'Model call timed out.', retryable: true }, { cause });
    }
    throw new AgentFailure('calling_model', { code: 'MODEL_CALL_FAILED', message: 'Model stream failed.', retryable: false }, { cause });
  } finally {
    clearTimeout(timer);
  }
  run.signal.throwIfAborted();
  if (timeout.signal.aborted) {
    throw new AgentFailure('calling_model', { code: 'MODEL_TIMEOUT', message: 'Model call timed out.', retryable: true });
  }
  if (!message || message.stopReason === 'aborted') {
    throw new AgentFailure('calling_model', { code: 'MODEL_CALL_FAILED', message: 'Model call did not complete.', retryable: false });
  }
  return message;
}

/** Checks provider protocol before executing calls or treating the response as final. */
function validateMessage(message: AssistantMessage): void {
  const calls = message.content.filter(block => block.type === 'toolCall');
  if (message.stopReason === 'stop' && !calls.length) {
    if (message.content.some(block => block.type === 'text' && block.text.trim())) return;
    throw new AgentFailure('calling_model', { code: 'MODEL_CALL_FAILED', message: 'Model returned no visible response.', retryable: true });
  }
  const ids = new Set<string>();
  if (message.stopReason === 'toolUse' && calls.length && calls.every(call => {
    if (!call.id || !call.name || ids.has(call.id) || !call.arguments
      || typeof call.arguments !== 'object' || Array.isArray(call.arguments)) return false;
    ids.add(call.id);
    return true;
  })) return;
  throw new AgentFailure('calling_model', { code: 'MODEL_PROTOCOL_ERROR', message: 'Model returned an incomplete or invalid response.', retryable: false });
}
