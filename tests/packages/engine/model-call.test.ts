/*
 * Protects ModelCall attempt isolation, structured retry, timeout, and completion semantics.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createModelFailure,
  type Api,
  type AssistantMessage,
  type Context,
  type Model,
  type Models,
} from '@megumi/ai';
import type { EnginePolicy } from '@megumi/engine';
import { AssistantMessageEventStream } from '../../../packages/ai/src/utils/event-stream';
import {
  executeModelCall,
  type ModelCallEvent,
} from '../../../packages/engine/src/model-call';

const ZERO_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const model: Model<Api> = {
  id: 'model:1',
  name: 'Test Model',
  api: 'test-api',
  provider: 'provider:1',
  baseUrl: 'https://provider.invalid',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 4_096,
  maxTokens: 512,
};

const context: Context = {
  systemPrompt: 'Be useful.',
  messages: [],
};

const policy: EnginePolicy = {
  maxModelCallsPerRun: 8,
  maxToolRoundsPerRun: 6,
  maxToolCallsPerModelCall: 8,
  maxToolCallsPerRun: 24,
  maxConcurrentToolExecutions: 4,
  modelCallTimeoutMs: 500,
  toolExecutionTimeoutMs: 30_000,
  cancellationTimeoutMs: 5_000,
  maxModelCallAttempts: 2,
  modelRetryDelayMs: 10,
  maxToolExecutionsPerCall: 1,
  toolRetryDelayMs: 0,
  terminalRunRetentionMs: 60_000,
};

function assistantMessage(
  content: AssistantMessage['content'],
  stopReason: AssistantMessage['stopReason'] = 'stop',
): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: ZERO_USAGE,
    stopReason,
    timestamp: 1,
  };
}

function successfulStream(input: {
  text: string;
  toolCall?: { id: string; name: string; arguments: Record<string, unknown> };
}): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  const content: AssistantMessage['content'] = [{ type: 'text', text: input.text }];
  if (input.toolCall) content.push({ type: 'toolCall', ...input.toolCall });
  const message = assistantMessage(content, input.toolCall ? 'toolUse' : 'stop');
  stream.push({ type: 'start', partial: assistantMessage([], 'stop') });
  stream.push({
    type: 'text_delta',
    contentIndex: 0,
    delta: input.text,
    partial: assistantMessage([{ type: 'text', text: input.text }], 'stop'),
  });
  if (input.toolCall) {
    stream.push({
      type: 'toolcall_end',
      contentIndex: 1,
      toolCall: { type: 'toolCall', ...input.toolCall },
      partial: message,
    });
  }
  stream.push({
    type: 'done',
    reason: input.toolCall ? 'toolUse' : 'stop',
    message,
  });
  return stream;
}

function failedStream(input: {
  partialText: string;
  retryable: boolean;
  retryAfterMs?: number;
  toolCall?: { id: string; name: string; arguments: Record<string, unknown> };
  code?: 'rate_limited' | 'unknown';
}): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  const partialContent: AssistantMessage['content'] = [
    { type: 'text', text: input.partialText },
  ];
  if (input.toolCall) partialContent.push({ type: 'toolCall', ...input.toolCall });
  const partial = assistantMessage(partialContent, 'error');
  stream.push({ type: 'start', partial });
  stream.push({
    type: 'text_delta',
    contentIndex: 0,
    delta: input.partialText,
    partial,
  });
  if (input.toolCall) {
    stream.push({
      type: 'toolcall_end',
      contentIndex: 1,
      toolCall: { type: 'toolCall', ...input.toolCall },
      partial,
    });
  }
  const failure = createModelFailure({
    code: input.code ?? 'rate_limited',
    retryable: input.retryable,
    ...(input.retryAfterMs === undefined ? {} : { retryAfterMs: input.retryAfterMs }),
  });
  partial.failure = failure;
  partial.errorMessage = failure.message;
  stream.push({ type: 'error', reason: 'error', failure, error: partial });
  return stream;
}

function fakeModels(
  streamSimple: Models['streamSimple'],
): Models {
  return { streamSimple } as Models;
}

async function collectEvents(
  input: Parameters<typeof executeModelCall>[0],
): Promise<ModelCallEvent[]> {
  const events: ModelCallEvent[] = [];
  for await (const event of executeModelCall(input)) events.push(event);
  return events;
}

function request(
  models: Models,
  overrides: Partial<Parameters<typeof executeModelCall>[0]> = {},
): Parameters<typeof executeModelCall>[0] {
  return {
    modelCallId: 'model-call:1',
    runId: 'run:1',
    sessionId: 'session:1',
    models,
    model,
    context,
    signal: new AbortController().signal,
    policy,
    clock: { now: () => '2026-07-31T00:00:00.000Z' },
    ...overrides,
  };
}

describe('executeModelCall', () => {
  it('uses Models directly and exposes ToolCalls only with a complete response', async () => {
    const streamSimple = vi.fn<Models['streamSimple']>(() => successfulStream({
      text: 'Done.',
      toolCall: { id: 'tool-call:1', name: 'read_file', arguments: { path: 'README.md' } },
    }));
    const events = await collectEvents(request(fakeModels(streamSimple)));

    expect(streamSimple).toHaveBeenCalledOnce();
    expect(streamSimple.mock.calls[0]?.[0]).toBe(model);
    expect(streamSimple.mock.calls[0]?.[1]).toBe(context);
    expect(streamSimple.mock.calls[0]?.[2]).toMatchObject({
      sessionId: 'session:1',
      maxRetries: 0,
      timeoutMs: policy.modelCallTimeoutMs,
    });
    expect(streamSimple.mock.calls[0]?.[2]?.signal).toBeInstanceOf(AbortSignal);
    expect(events.slice(0, -1).every((event) => !('toolCalls' in event))).toBe(true);
    expect(events.at(-1)).toMatchObject({
      type: 'completed',
      modelCall: {
        modelCallId: 'model-call:1',
        runId: 'run:1',
        status: 'completed',
      },
      message: { stopReason: 'toolUse' },
      toolCalls: [{
        toolCallId: 'tool-call:1',
        sourceModelCallId: 'model-call:1',
        callOrder: 0,
        toolName: 'read_file',
        input: { path: 'README.md' },
      }],
    });
  });

  it('resets failed live output and never commits its text or ToolCalls into a retry', async () => {
    const staleToolCall = {
      id: 'tool-call:stale',
      name: 'write_file',
      arguments: { path: 'stale.txt' },
    };
    const freshToolCall = {
      id: 'tool-call:fresh',
      name: 'read_file',
      arguments: { path: 'fresh.txt' },
    };
    const streams = [
      failedStream({
        partialText: 'stale text',
        retryable: true,
        retryAfterMs: 25,
        toolCall: staleToolCall,
      }),
      successfulStream({ text: 'fresh text', toolCall: freshToolCall }),
    ];
    const streamSimple = vi.fn<Models['streamSimple']>(() => streams.shift()!);
    const waits: number[] = [];
    const events = await collectEvents(request(fakeModels(streamSimple), {
      wait: async (delayMs) => {
        waits.push(delayMs);
      },
    }));

    expect(streamSimple).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([25]);
    const resetIndex = events.findIndex((event) => event.type === 'projection_reset');
    const retryIndex = events.findIndex((event) => event.type === 'retrying');
    const secondAttemptIndex = events.findIndex(
      (event) => event.type === 'attempt_started' && event.attemptNumber === 2,
    );
    expect(resetIndex).toBeGreaterThan(-1);
    expect(resetIndex).toBeLessThan(retryIndex);
    expect(retryIndex).toBeLessThan(secondAttemptIndex);
    expect(events.at(-1)).toMatchObject({
      type: 'completed',
      message: {
        content: [
          { type: 'text', text: 'fresh text' },
          { type: 'toolCall', id: 'tool-call:fresh' },
        ],
      },
      toolCalls: [{ toolCallId: 'tool-call:fresh' }],
    });
    expect(JSON.stringify(events.at(-1))).not.toContain('stale text');
    expect(JSON.stringify(events.at(-1))).not.toContain('tool-call:stale');
  });

  it('does not retry unknown failures by parsing their message', async () => {
    const streamSimple = vi.fn<Models['streamSimple']>(() => failedStream({
      partialText: 'HTTP 503 retry me',
      retryable: false,
      code: 'unknown',
    }));
    const events = await collectEvents(request(fakeModels(streamSimple)));

    expect(streamSimple).toHaveBeenCalledOnce();
    expect(events.some((event) => event.type === 'retrying')).toBe(false);
    expect(events.at(-1)).toMatchObject({
      type: 'failed',
      failure: { code: 'unknown', retryable: false },
      partial: { text: 'HTTP 503 retry me' },
    });
  });

  it('does not start or retry when the Run signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const streamSimple = vi.fn<Models['streamSimple']>(() => successfulStream({ text: 'late' }));
    const events = await collectEvents(request(fakeModels(streamSimple), {
      signal: controller.signal,
    }));

    expect(streamSimple).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({
      type: 'failed',
      failure: { code: 'aborted', retryable: false },
    });
  });

  it('stops before the next attempt when cancellation arrives during retry wait', async () => {
    const controller = new AbortController();
    const streamSimple = vi.fn<Models['streamSimple']>(() => failedStream({
      partialText: 'temporary',
      retryable: true,
    }));
    const events = await collectEvents(request(fakeModels(streamSimple), {
      signal: controller.signal,
      wait: async () => {
        controller.abort();
      },
    }));

    expect(streamSimple).toHaveBeenCalledOnce();
    expect(events.filter((event) => event.type === 'attempt_started')).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({
      type: 'failed',
      modelCall: { status: 'cancelled' },
      failure: { code: 'aborted', retryable: false },
    });
  });

  it('recognizes its own timeout as retryable even when a provider ignores abort', async () => {
    const neverCompletes = new AssistantMessageEventStream();
    const streams = [neverCompletes, successfulStream({ text: 'after timeout' })];
    const streamSimple = vi.fn<Models['streamSimple']>(() => streams.shift()!);
    const events = await collectEvents(request(fakeModels(streamSimple), {
      policy: {
        ...policy,
        modelCallTimeoutMs: 5,
        modelRetryDelayMs: 0,
      },
    }));

    expect(streamSimple).toHaveBeenCalledTimes(2);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'retrying',
      failure: expect.objectContaining({ code: 'timeout', retryable: true }),
    }));
    expect(events.at(-1)).toMatchObject({
      type: 'completed',
      message: { content: [{ type: 'text', text: 'after timeout' }] },
    });
    expect(streamSimple.mock.calls[0]?.[2]?.signal?.aborted).toBe(true);
  });
});
