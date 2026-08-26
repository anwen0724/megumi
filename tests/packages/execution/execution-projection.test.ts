/* Verifies Agent Event projection stays a business Runtime Event and Session concern only. */
import type { AssistantMessage, ToolResultMessage } from '@megumi/ai';
import { createEventBus, type AnyEvent } from '@megumi/events';
import {
  createAgentEventListener,
  type CreateAgentEventListenerOptions,
  type ExecutionProjectionRuntime,
  type SessionMessageCommitter,
} from '@megumi/execution';
import { describe, expect, it, vi } from 'vitest';
import { executionMetadata, model } from './execution-test-fixtures';

const metadata = executionMetadata();

describe('Execution projection', () => {
  it('projects turn, message, and retry Runtime Events without diagnostic dependencies', async () => {
    const { listener, published } = fixture();
    await listener({ type: 'turn_start', executionId: metadata.executionId });
    await listener({
      type: 'message_start',
      executionId: metadata.executionId,
      message: assistant([], 'pending'),
    });
    await listener({
      type: 'message_update',
      executionId: metadata.executionId,
      message: assistant([
        { type: 'thinking', thinking: 'Plan...' },
        { type: 'text', text: 'partial' },
      ], 'pending'),
    });
    await listener({
      type: 'model_call_attempt_started',
      executionId: metadata.executionId,
      turn: 1,
      attempt: 1,
    });
    await listener({
      type: 'model_call_attempt_ended',
      executionId: metadata.executionId,
      turn: 1,
      attempt: 1,
      outcome: 'retrying',
      error: { code: 'model_call_failed', message: '429', retryable: true },
    });
    await listener({
      type: 'model_call_attempt_started',
      executionId: metadata.executionId,
      turn: 1,
      attempt: 2,
    });
    await listener({
      type: 'model_call_attempt_ended',
      executionId: metadata.executionId,
      turn: 1,
      attempt: 2,
      outcome: 'succeeded',
    });

    expect(published.map((event) => event.type)).toEqual([
      'turn.started',
      'message.started',
      'message.update',
      'message.thinking.update',
      'turn.retry.started',
      'turn.retry.completed',
    ]);
    expect(published.every((event) => (
      event.sessionId === metadata.sessionId && event.executionId === metadata.executionId
    ))).toBe(true);
  });

  it('commits and projects ordered Tool Result messages for a Tool turn', async () => {
    const { listener, published } = fixture();
    const message = assistant([
      { type: 'toolCall', id: 'call:1', name: 'lookup', arguments: {} },
      { type: 'toolCall', id: 'call:2', name: 'lookup', arguments: {} },
    ], 'toolUse');
    await listener({ type: 'turn_start', executionId: metadata.executionId });
    await listener({
      type: 'tool_execution_start',
      executionId: metadata.executionId,
      toolCallId: 'call:1',
      toolName: 'lookup',
      arguments: {},
    });
    await listener({
      type: 'tool_execution_start',
      executionId: metadata.executionId,
      toolCallId: 'call:2',
      toolName: 'lookup',
      arguments: {},
    });
    await listener({ type: 'message_end', executionId: metadata.executionId, message });
    await listener({
      type: 'turn_end',
      executionId: metadata.executionId,
      message,
      toolResults: [toolResult('call:1', 'a'), toolResult('call:2', 'b')],
    });

    expect(published.map((event) => event.type)).toEqual([
      'turn.started',
      'tool_execution.requested',
      'tool_execution.requested',
      'message.ended',
      'message.started',
      'message.ended',
      'message.started',
      'message.ended',
      'turn.ended',
    ]);
  });

  it('isolates Runtime Event publication failures', async () => {
    const { options } = fixture();
    const listener = createAgentEventListener({
      ...options,
      events: { publish: () => { throw new Error('Runtime Event sink unavailable.'); } },
    });

    await expect(listener({ type: 'turn_start', executionId: metadata.executionId }))
      .resolves.toBeUndefined();
  });
});

function fixture(): {
  readonly listener: ReturnType<typeof createAgentEventListener>;
  readonly published: AnyEvent[];
  readonly options: CreateAgentEventListenerOptions;
} {
  const events = createEventBus();
  const published: AnyEvent[] = [];
  events.subscribe({}, (event) => { published.push(event); });
  const runtime: ExecutionProjectionRuntime = {
    toolRequests: new Map(),
    toolSystemFailures: new Map(),
    activeScope: {
      modelCallId: 'model-call:1',
      definitions: [],
      tools: [],
      released: false,
    },
  };
  const options: CreateAgentEventListenerOptions = {
    metadata,
    events,
    committer: committer(),
    ids: { createSessionMessageId: () => 'message:1' },
    clock: { now: () => '2026-07-31T00:00:00.000Z' },
    runtime,
    onAgentEnd: vi.fn(),
  };
  return { listener: createAgentEventListener(options), published, options };
}

function committer(): SessionMessageCommitter {
  return {
    commitModelResponse: async () => ({
      status: 'saved',
      messageId: 'message:model',
      entryId: 'entry:model',
    }),
    commitToolResults: async ({ results }) => ({
      status: 'saved',
      items: results.map((result, index) => ({
        toolCallId: result.toolCallId,
        messageId: `message:tool:${index + 1}`,
        status: result.status,
      })),
    }),
    commitAssistantReply: async () => ({
      status: 'saved',
      messageId: 'message:reply',
      entryId: 'entry:reply',
    }),
  };
}

function assistant(
  content: AssistantMessage['content'],
  stopReason: AssistantMessage['stopReason'],
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
    timestamp: 2,
  };
}

function toolResult(toolCallId: string, text: string): ToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId,
    toolName: 'lookup',
    content: [{ type: 'text', text }],
    isError: false,
    timestamp: 3,
  };
}
