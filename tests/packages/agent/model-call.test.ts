/* Verifies one logical Agent ModelCall through its package-internal protocol seam. */
import { describe, expect, it, vi } from 'vitest';
import {
  AssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type Model,
} from '@megumi/ai';
import { runModelCall } from '../../../packages/agent/src/model-call';
import type { AgentContext, AgentEvent } from '../../../packages/agent/src/types';

const model: Model<Api> = {
  id: 'test-model',
  name: 'Test Model',
  api: 'test-api',
  provider: 'test-provider',
  baseUrl: 'https://example.invalid',
  reasoning: true,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8_192,
  maxTokens: 1_024,
};

const context: AgentContext = {
  systemPrompt: 'Be concise.',
  messages: [{ role: 'user', content: 'Inspect this.', timestamp: 1 }],
  tools: [],
};

function assistant(
  content: AssistantMessage['content'],
  stopReason: AssistantMessage['stopReason'],
  errorMessage?: string,
): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 10,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 15,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    ...(errorMessage ? { errorMessage } : {}),
    timestamp: 2,
  };
}

function completedStream(message: AssistantMessage): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  stream.push({ type: 'start', partial: assistant([], 'pending') });
  stream.push({ type: 'text_delta', contentIndex: 0, delta: 'done', partial: message });
  stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message });
  stream.end();
  return stream;
}

function terminalStream(message: AssistantMessage): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  stream.push({ type: 'start', partial: assistant([], 'pending') });
  if (message.stopReason === 'error' || message.stopReason === 'aborted') {
    stream.push({ type: 'error', reason: message.stopReason, error: message });
  } else {
    stream.push({
      type: 'done',
      reason: message.stopReason as 'stop' | 'length' | 'toolUse' | 'deferred',
      message,
    });
  }
  stream.end();
  return stream;
}

describe('Agent ModelCall', () => {
  it('returns the completed message and publishes full streaming snapshots', async () => {
    const message = assistant([{ type: 'text', text: 'done' }], 'stop');
    const events: AgentEvent[] = [];
    const stream = vi.fn(() => completedStream(message));

    const result = await runModelCall({
      model,
      thinkingLevel: 'high',
      context,
      stream,
      signal: new AbortController().signal,
      policy: {
        maxModelCallAttempts: 2,
        modelCallTimeoutMs: 1_000,
        modelRetryDelayMs: 0,
        maxContextOverflowRecoveries: 1,
      },
      emit: async (event) => { events.push(event); },
    });

    expect(result).toEqual({ status: 'completed', message, toolCalls: [], context });
    expect(stream).toHaveBeenCalledWith(
      model,
      { systemPrompt: 'Be concise.', messages: [...context.messages], tools: [] },
      expect.objectContaining({ reasoning: 'high', signal: expect.any(AbortSignal), timeoutMs: 1_000 }),
    );
    expect(events).toContainEqual({ type: 'message_update', message });
  });

  it('returns model-ordered ToolCalls only from a valid tool-use response', async () => {
    const message = assistant([
      { type: 'text', text: 'I will inspect it.' },
      { type: 'toolCall', id: 'call-1', name: 'read_file', arguments: { path: 'a.ts' } },
      { type: 'toolCall', id: 'call-2', name: 'read_file', arguments: { path: 'b.ts' } },
    ], 'toolUse');

    const result = await runModelCall({
      model,
      thinkingLevel: 'high',
      context,
      stream: () => terminalStream(message),
      signal: new AbortController().signal,
      policy: {
        maxModelCallAttempts: 1,
        modelCallTimeoutMs: 1_000,
        modelRetryDelayMs: 0,
        maxContextOverflowRecoveries: 0,
      },
      emit: async () => undefined,
    });

    expect(result).toEqual({
      status: 'completed',
      message,
      toolCalls: [message.content[1], message.content[2]],
      context,
    });
  });

  it('retries a transient provider failure without retaining its projection', async () => {
    const failed = assistant([{ type: 'text', text: 'stale' }], 'error', '429 rate limit exceeded');
    const completed = assistant([{ type: 'text', text: 'fresh' }], 'stop');
    const streams = [terminalStream(failed), completedStream(completed)];
    const updates: AssistantMessage[] = [];

    const result = await runModelCall({
      model,
      thinkingLevel: 'high',
      context,
      stream: () => streams.shift()!,
      signal: new AbortController().signal,
      policy: {
        maxModelCallAttempts: 2,
        modelCallTimeoutMs: 1_000,
        modelRetryDelayMs: 0,
        maxContextOverflowRecoveries: 0,
      },
      emit: async (event) => {
        if (event.type === 'message_update') updates.push(event.message);
      },
    });

    expect(result).toMatchObject({ status: 'completed', message: completed });
    expect(updates.at(-1)).toBe(completed);
  });

  it('recovers Context overflow with a new Context while keeping one logical call', async () => {
    const overflow = assistant([], 'error', 'prompt is too long: 9000 tokens > 8192 maximum');
    const completed = assistant([{ type: 'text', text: 'after recovery' }], 'stop');
    const recoveredContext: AgentContext = {
      ...context,
      messages: [{ role: 'user', content: 'compacted', timestamp: 3 }],
    };
    const recoverOverflow = vi.fn(async () => ({
      status: 'ready' as const,
      context: recoveredContext,
    }));
    const streams = [terminalStream(overflow), completedStream(completed)];

    const result = await runModelCall({
      model,
      thinkingLevel: 'high',
      context,
      contextProvider: { prepare: async () => ({ status: 'ready', context }), recoverOverflow },
      stream: () => streams.shift()!,
      signal: new AbortController().signal,
      policy: {
        maxModelCallAttempts: 1,
        modelCallTimeoutMs: 1_000,
        modelRetryDelayMs: 0,
        maxContextOverflowRecoveries: 1,
      },
      emit: async () => undefined,
    });

    expect(result).toMatchObject({ status: 'completed', message: completed, context: recoveredContext });
    expect(recoverOverflow).toHaveBeenCalledWith(expect.objectContaining({
      model,
      context,
      attempt: 1,
      signal: expect.any(AbortSignal),
    }));
  });

  it('returns cancelled with the latest partial message when the root signal aborts', async () => {
    const controller = new AbortController();
    const partial = assistant([{ type: 'text', text: 'partial' }], 'pending');
    const stream = new AssistantMessageEventStream();
    stream.push({ type: 'start', partial: assistant([], 'pending') });
    stream.push({ type: 'text_delta', contentIndex: 0, delta: 'partial', partial });
    let observeUpdate!: () => void;
    const updateObserved = new Promise<void>((resolve) => { observeUpdate = resolve; });

    const execution = runModelCall({
      model,
      thinkingLevel: 'high',
      context,
      stream: () => stream,
      signal: controller.signal,
      policy: {
        maxModelCallAttempts: 1,
        modelCallTimeoutMs: 1_000,
        modelRetryDelayMs: 0,
        maxContextOverflowRecoveries: 0,
      },
      emit: async (event) => {
        if (event.type === 'message_update') observeUpdate();
      },
    });
    await updateObserved;
    controller.abort();

    await expect(execution).resolves.toEqual({ status: 'cancelled', partial });
  });

  it('classifies non-overflow length termination as a non-retryable model failure', async () => {
    const truncated = assistant([{ type: 'text', text: 'unfinished' }], 'length');

    const result = await runModelCall({
      model,
      thinkingLevel: 'high',
      context,
      stream: () => terminalStream(truncated),
      signal: new AbortController().signal,
      policy: {
        maxModelCallAttempts: 2,
        modelCallTimeoutMs: 1_000,
        modelRetryDelayMs: 0,
        maxContextOverflowRecoveries: 1,
      },
      emit: async () => undefined,
    });

    expect(result).toMatchObject({
      status: 'failed',
      error: {
        code: 'model_call_failed',
        message: 'Model output was truncated before completion.',
        retryable: false,
      },
    });
  });

  it('fails as context_failed when overflow recovery is unavailable', async () => {
    const overflow = assistant([], 'error', 'prompt is too long: 9000 tokens > 8192 maximum');

    const result = await runModelCall({
      model,
      thinkingLevel: 'high',
      context,
      stream: () => terminalStream(overflow),
      signal: new AbortController().signal,
      policy: {
        maxModelCallAttempts: 1,
        modelCallTimeoutMs: 1_000,
        modelRetryDelayMs: 0,
        maxContextOverflowRecoveries: 1,
      },
      emit: async () => undefined,
    });

    expect(result).toMatchObject({ status: 'failed', error: { code: 'context_failed' } });
  });

  it('settles a provider that ignores cancellation as a retryable timeout failure', async () => {
    const result = await runModelCall({
      model,
      thinkingLevel: 'high',
      context,
      stream: () => new AssistantMessageEventStream(),
      signal: new AbortController().signal,
      policy: {
        maxModelCallAttempts: 1,
        modelCallTimeoutMs: 5,
        modelRetryDelayMs: 0,
        maxContextOverflowRecoveries: 0,
      },
      emit: async () => undefined,
    });

    expect(result).toEqual({
      status: 'failed',
      error: { code: 'model_call_failed', message: 'Model call timed out.', retryable: true },
    });
  });
});
