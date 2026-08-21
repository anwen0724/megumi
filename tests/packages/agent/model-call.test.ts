/* Verifies one logical Agent ModelCall through its package-internal protocol seam. */
import { describe, expect, it, vi } from 'vitest';
import {
  AssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type Model,
} from '@megumi/ai';
import { runModelCall } from '../../../packages/agent/src/model-call';
import type {
  AgentContext,
  AgentEvent,
  AgentExecutionProgress,
} from '../../../packages/agent/src/types';

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

const executionId = 'execution:model-1';
const turn = 1;

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

interface RunModelCallOverrides {
  readonly stream: (model: Model<Api>, context: import('@megumi/ai').Context) => AssistantMessageEventStream;
  readonly policy?: {
    readonly maxModelCallAttempts: number;
    readonly modelCallTimeoutMs: number;
    readonly modelRetryDelayMs: number;
    readonly maxContextOverflowRecoveries: number;
  };
  readonly contextProvider?: {
    readonly prepare: (input: never) => Promise<never>;
    readonly recoverOverflow?: (input: never) => Promise<never>;
  };
  readonly emit?: (event: AgentEvent) => Promise<void>;
  readonly report?: (progress: AgentExecutionProgress) => Promise<void>;
  readonly signal?: AbortSignal;
}

function runCall(overrides: RunModelCallOverrides): Promise<ReturnType<typeof runModelCall>> {
  return runModelCall({
    model,
    thinkingLevel: 'high',
    context,
    stream: overrides.stream,
    contextProvider: overrides.contextProvider as never,
    signal: overrides.signal ?? new AbortController().signal,
    policy: overrides.policy ?? {
      maxModelCallAttempts: 2,
      modelCallTimeoutMs: 1_000,
      modelRetryDelayMs: 0,
      maxContextOverflowRecoveries: 0,
    },
    executionId,
    turn,
    report: overrides.report ?? (async () => undefined),
    emit: overrides.emit ?? (async () => undefined),
  });
}

describe('Agent ModelCall', () => {
  it('returns the completed message and publishes attempt and streaming facts', async () => {
    const message = assistant([{ type: 'text', text: 'done' }], 'stop');
    const events: AgentEvent[] = [];
    const progress: AgentExecutionProgress[] = [];
    const stream = vi.fn(() => completedStream(message));

    const result = await runCall({
      stream,
      emit: async (event) => { events.push(event); },
      report: async (item) => { progress.push(item); },
    });

    expect(result).toEqual({
      status: 'completed',
      message,
      toolCalls: [],
      context,
    });
    expect(stream).toHaveBeenCalledWith(
      model,
      { systemPrompt: 'Be concise.', messages: [...context.messages], tools: [] },
      expect.objectContaining({ reasoning: 'high', signal: expect.any(AbortSignal), timeoutMs: 1_000 }),
    );
    expect(events).toEqual([
      { type: 'model_call_attempt_started', executionId, turn, attempt: 1 },
      { type: 'message_start', executionId, message: expect.objectContaining({ role: 'assistant', content: [] }) },
      { type: 'message_update', executionId, message },
      { type: 'model_call_attempt_ended', executionId, turn, attempt: 1, outcome: 'succeeded' },
    ]);
    expect(progress).toEqual([{ attempt: 1 }]);
  });

  it('returns model-ordered ToolCalls only from a valid tool-use response', async () => {
    const message = assistant([
      { type: 'text', text: 'I will inspect it.' },
      { type: 'toolCall', id: 'call-1', name: 'read_file', arguments: { path: 'a.ts' } },
      { type: 'toolCall', id: 'call-2', name: 'read_file', arguments: { path: 'b.ts' } },
    ], 'toolUse');

    const result = await runCall({
      stream: () => terminalStream(message),
      policy: {
        maxModelCallAttempts: 1,
        modelCallTimeoutMs: 1_000,
        modelRetryDelayMs: 0,
        maxContextOverflowRecoveries: 0,
      },
    });

    expect(result).toEqual({
      status: 'completed',
      message,
      toolCalls: [message.content[1], message.content[2]],
      context,
    });
  });

  it('retries a transient provider failure and reports retrying between attempts', async () => {
    const failed = assistant([{ type: 'text', text: 'stale' }], 'error', '429 rate limit exceeded');
    const completed = assistant([{ type: 'text', text: 'fresh' }], 'stop');
    const streams = [terminalStream(failed), completedStream(completed)];
    const events: AgentEvent[] = [];

    const result = await runCall({
      stream: () => streams.shift()!,
      emit: async (event) => { events.push(event); },
    });

    expect(result).toMatchObject({ status: 'completed', message: completed });
    expect(events.map((event) => event.type)).toEqual([
      'model_call_attempt_started',
      'message_start',
      'model_call_attempt_ended',
      'model_call_attempt_started',
      'message_update',
      'message_update',
      'model_call_attempt_ended',
    ]);
    const attempts = events.filter(
      (event): event is Extract<AgentEvent, { type: 'model_call_attempt_started' | 'model_call_attempt_ended' }> =>
        event.type === 'model_call_attempt_started' || event.type === 'model_call_attempt_ended',
    );
    expect(attempts[0]).toMatchObject({ type: 'model_call_attempt_started', attempt: 1, executionId, turn });
    expect(attempts[1]).toMatchObject({ type: 'model_call_attempt_ended', attempt: 1, outcome: 'retrying' });
    expect(attempts[2]).toMatchObject({ type: 'model_call_attempt_started', attempt: 2 });
    expect(attempts[3]).toMatchObject({ type: 'model_call_attempt_ended', attempt: 2, outcome: 'succeeded' });
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
    const progress: AgentExecutionProgress[] = [];

    const result = await runCall({
      contextProvider: {
        prepare: async () => { throw new Error('unused'); },
        recoverOverflow: recoverOverflow as never,
      },
      stream: () => streams.shift()!,
      report: async (item) => { progress.push(item); },
      policy: {
        maxModelCallAttempts: 1,
        modelCallTimeoutMs: 1_000,
        modelRetryDelayMs: 0,
        maxContextOverflowRecoveries: 1,
      },
    });

    expect(result).toMatchObject({ status: 'completed', message: completed, context: recoveredContext });
    expect(recoverOverflow).toHaveBeenCalledWith(expect.objectContaining({
      model,
      context,
      attempt: 1,
      signal: expect.any(AbortSignal),
    }));
    expect(progress).toEqual([
      { attempt: 1 },
      { phase: 'preparing_context' },
      { phase: 'calling_model' },
      { attempt: 2 },
    ]);
  });

  it('returns cancelled with the latest partial message when the root signal aborts', async () => {
    const controller = new AbortController();
    const partial = assistant([{ type: 'text', text: 'partial' }], 'pending');
    const stream = new AssistantMessageEventStream();
    stream.push({ type: 'start', partial: assistant([], 'pending') });
    stream.push({ type: 'text_delta', contentIndex: 0, delta: 'partial', partial });
    let observeUpdate!: () => void;
    const updateObserved = new Promise<void>((resolve) => { observeUpdate = resolve; });
    const events: AgentEvent[] = [];

    const execution = runCall({
      stream: () => stream,
      signal: controller.signal,
      policy: {
        maxModelCallAttempts: 1,
        modelCallTimeoutMs: 1_000,
        modelRetryDelayMs: 0,
        maxContextOverflowRecoveries: 0,
      },
      emit: async (event) => {
        events.push(event);
        if (event.type === 'message_update') observeUpdate();
      },
    });
    await updateObserved;
    controller.abort();

    const result = await execution;
    expect(result).toEqual({ status: 'cancelled', partial });
    expect(events.at(-1)).toMatchObject({
      type: 'model_call_attempt_ended',
      attempt: 1,
      outcome: 'cancelled',
    });
  });

  it('classifies non-overflow length termination as a non-retryable model failure', async () => {
    const truncated = assistant([{ type: 'text', text: 'unfinished' }], 'length');
    const events: AgentEvent[] = [];

    const result = await runCall({
      stream: () => terminalStream(truncated),
      emit: async (event) => { events.push(event); },
      policy: {
        maxModelCallAttempts: 2,
        modelCallTimeoutMs: 1_000,
        modelRetryDelayMs: 0,
        maxContextOverflowRecoveries: 1,
      },
    });

    expect(result).toMatchObject({
      status: 'failed',
      error: {
        code: 'model_call_failed',
        message: 'Model output was truncated before completion.',
        retryable: false,
      },
    });
    expect(events.at(-1)).toMatchObject({
      type: 'model_call_attempt_ended',
      attempt: 1,
      outcome: 'failed',
      error: { code: 'model_call_failed' },
    });
  });

  it('fails as context_failed when overflow recovery is unavailable', async () => {
    const overflow = assistant([], 'error', 'prompt is too long: 9000 tokens > 8192 maximum');

    const result = await runCall({
      stream: () => terminalStream(overflow),
      policy: {
        maxModelCallAttempts: 1,
        modelCallTimeoutMs: 1_000,
        modelRetryDelayMs: 0,
        maxContextOverflowRecoveries: 1,
      },
    });

    expect(result).toMatchObject({ status: 'failed', error: { code: 'context_failed' } });
  });

  it('settles a provider that ignores cancellation as a retryable timeout failure', async () => {
    const events: AgentEvent[] = [];

    const result = await runCall({
      stream: () => new AssistantMessageEventStream(),
      emit: async (event) => { events.push(event); },
      policy: {
        maxModelCallAttempts: 1,
        modelCallTimeoutMs: 5,
        modelRetryDelayMs: 0,
        maxContextOverflowRecoveries: 0,
      },
    });

    expect(result).toEqual({
      status: 'failed',
      error: { code: 'model_call_failed', message: 'Model call timed out.', retryable: true },
    });
    expect(events.at(-1)).toMatchObject({
      type: 'model_call_attempt_ended',
      attempt: 1,
      outcome: 'failed',
      error: { code: 'model_call_failed', retryable: true },
    });
  });
});
