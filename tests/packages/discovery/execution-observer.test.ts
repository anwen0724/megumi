/* Verifies the Execution Observer: best-effort observability and AgentEvent projections. */
import { describe, expect, it, vi } from 'vitest';
import type { AssistantMessage, ToolResultMessage } from '@megumi/ai';
import { createEventBus, type AnyEvent } from '@megumi/events';
import {
  createAgentEventListener,
  createExecutionObserver,
  type CreateAgentEventListenerOptions,
  type ExecutionProjectionRuntime,
} from '../../../packages/agent/discovery/src/execution/execution-observer';
import type { SessionMessageCommitter } from '../../../packages/agent/discovery/src/execution/session-settlement';
import { executionMetadata, model } from './execution-test-fixtures';

const metadata = executionMetadata();

function assistant(content: AssistantMessage['content'], stopReason: AssistantMessage['stopReason']): AssistantMessage {
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

function toolResult(callId: string, content: string): ToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId: callId,
    toolName: 'lookup',
    content: [{ type: 'text', text: content }],
    isError: false,
    timestamp: 3,
  };
}

function fixture(overrides: {
  readonly committer?: SessionMessageCommitter;
  readonly onAgentEnd?: () => void;
  readonly observer?: ReturnType<typeof createExecutionObserver>;
} = {}): {
  listener: ReturnType<typeof createAgentEventListener>;
  published: AnyEvent[];
  runtime: ExecutionProjectionRuntime;
  onAgentEnd: ReturnType<typeof vi.fn>;
  options: CreateAgentEventListenerOptions;
} {
  const eventsBus = createEventBus();
  const published: AnyEvent[] = [];
  eventsBus.subscribe({}, (event) => { published.push(event); });
  const onAgentEnd = overrides.onAgentEnd ?? vi.fn();
  const runtime: ExecutionProjectionRuntime = {
    toolRequests: new Map(),
    toolSystemFailures: new Map(),
    activeScope: { modelCallId: 'model-call:1', definitions: [], tools: [], released: false },
  };
  const options: CreateAgentEventListenerOptions = {
    metadata,
    events: eventsBus,
    committer: overrides.committer ?? ({
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
      commitAssistantReply: async () => ({ status: 'saved', messageId: 'message:reply', entryId: 'entry:reply' }),
    }) as SessionMessageCommitter,
    ids: { createSessionMessageId: () => 'message:1' },
    clock: { now: () => '2026-07-31T00:00:00.000Z' },
    observer: overrides.observer ?? createExecutionObserver({ metadata }),
    runtime,
    onAgentEnd,
  };
  return { listener: createAgentEventListener(options), published, runtime, onAgentEnd, options };
}

describe('Execution Observer', () => {
  it('isolates every observability failure from the execution', () => {
    const service = {
      startTrace: () => { throw new Error('trace exploded'); },
      endTrace: () => { throw new Error('trace exploded'); },
      startSpan: () => { throw new Error('span exploded'); },
      endSpan: () => { throw new Error('span exploded'); },
      runInTraceContext: () => { throw new Error('trace exploded'); },
      runInSpanContext: () => { throw new Error('span exploded'); },
      getCurrentTrace: () => undefined,
      getCurrentSpan: () => undefined,
      recordLog: () => { throw new Error('log exploded'); },
      recordMeasurement: () => { throw new Error('measurement exploded'); },
      flush: async () => undefined,
    } as never;
    const observer = createExecutionObserver({ metadata, observability: service });
    expect(() => observer.start()).not.toThrow();
    expect(() => observer.recordLog({ level: 'info', event: 'x' })).not.toThrow();
    expect(() => observer.recordMeasurement({ name: 'x', value: 1, unit: 'count' })).not.toThrow();
    expect(() => observer.endSpan(undefined, 'ok')).not.toThrow();
    expect(() => observer.end('ok')).not.toThrow();
  });

  it('projects turn, message, tool and retry facts in order', async () => {
    const { listener, published } = fixture();
    await listener({ type: 'turn_start', executionId: 'execution:1' });
    await listener({ type: 'message_start', executionId: 'execution:1', message: assistant([], 'pending') });
    await listener({
      type: 'message_update',
      executionId: 'execution:1',
      message: assistant([{ type: 'thinking', thinking: 'Plan...' }, { type: 'text', text: 'partial' }], 'pending'),
    });
    await listener({ type: 'model_call_attempt_started', executionId: 'execution:1', turn: 1, attempt: 1 });
    await listener({ type: 'model_call_attempt_ended', executionId: 'execution:1', turn: 1, attempt: 1, outcome: 'retrying', error: { code: 'model_call_failed', message: '429', retryable: true } });
    await listener({ type: 'model_call_attempt_started', executionId: 'execution:1', turn: 1, attempt: 2 });
    await listener({ type: 'model_call_attempt_ended', executionId: 'execution:1', turn: 1, attempt: 2, outcome: 'succeeded' });
    await listener({
      type: 'turn_end',
      executionId: 'execution:1',
      message: assistant([{ type: 'text', text: 'final' }], 'stop'),
      toolResults: [],
    });

    const types = published.map((event) => event.type);
    expect(types).toEqual([
      'turn.started',
      'message.started',
      'message.update',
      'message.thinking.update',
      'turn.retry.started',
      'turn.retry.completed',
    ]);
    for (const event of published) {
      expect(event).toMatchObject({ sessionId: 'session:1', executionId: 'execution:1' });
    }
  });

  it('projects ordered tool result message lifecycles on a tool turn', async () => {
    const { listener, published } = fixture();
    const toolMessage = assistant([
      { type: 'toolCall', id: 'call:1', name: 'lookup', arguments: {} },
      { type: 'toolCall', id: 'call:2', name: 'lookup', arguments: {} },
    ], 'toolUse');
    await listener({ type: 'turn_start', executionId: 'execution:1' });
    await listener({ type: 'tool_execution_start', executionId: 'execution:1', toolCallId: 'call:1', toolName: 'lookup', arguments: {} });
    await listener({ type: 'tool_execution_start', executionId: 'execution:1', toolCallId: 'call:2', toolName: 'lookup', arguments: {} });
    await listener({ type: 'message_end', executionId: 'execution:1', message: toolMessage });
    await listener({ type: 'turn_end', executionId: 'execution:1', message: toolMessage, toolResults: [toolResult('call:1', 'a'), toolResult('call:2', 'b')] });

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
    expect(published.filter((event) => event.type === 'message.started').map((event) => event.payload)).toEqual([
      { role: 'tool_result', messageId: 'message:tool:1' },
      { role: 'tool_result', messageId: 'message:tool:2' },
    ]);
  });

  it('releases the scope on agent_end and reports pending retries as failed', async () => {
    const onAgentEnd = vi.fn();
    const { listener, published } = fixture({ onAgentEnd });
    await listener({ type: 'turn_start', executionId: 'execution:1' });
    await listener({ type: 'model_call_attempt_started', executionId: 'execution:1', turn: 1, attempt: 1 });
    await listener({ type: 'model_call_attempt_ended', executionId: 'execution:1', turn: 1, attempt: 1, outcome: 'retrying', error: { code: 'model_call_failed', message: '429', retryable: true } });
    await listener({ type: 'model_call_attempt_started', executionId: 'execution:1', turn: 1, attempt: 2 });
    await listener({ type: 'model_call_attempt_ended', executionId: 'execution:1', turn: 1, attempt: 2, outcome: 'failed', error: { code: 'model_call_failed', message: '429', retryable: true } });
    await listener({ type: 'turn_end', executionId: 'execution:1', message: assistant([{ type: 'text', text: '' }], 'stop'), toolResults: [] });
    await listener({
      type: 'agent_end',
      executionId: 'execution:1',
      result: {
        executionId: 'execution:1',
        status: 'failed',
        newMessages: [],
        error: { code: 'model_call_failed', message: '429', retryable: true },
      },
    });

    expect(onAgentEnd).toHaveBeenCalledTimes(1);
    expect(published.map((event) => event.type)).toContain('turn.retry.failed');
  });

  it('isolates Runtime Event publication failures from the listener', async () => {
    const { options } = fixture();
    const throwing = createAgentEventListener({
      ...options,
      events: { publish: () => { throw new Error('sink unavailable'); } } as never,
    });
    await expect(throwing({ type: 'turn_start', executionId: 'execution:1' })).resolves.toBeUndefined();
  });

  it('does not project overflow recovery as an ordinary retry', async () => {
    const { listener, published } = fixture();
    await listener({ type: 'turn_start', executionId: 'execution:1' });
    await listener({ type: 'model_call_attempt_started', executionId: 'execution:1', turn: 1, attempt: 1 });
    await listener({ type: 'model_call_attempt_ended', executionId: 'execution:1', turn: 1, attempt: 1, outcome: 'retrying' });
    await listener({ type: 'model_call_attempt_started', executionId: 'execution:1', turn: 1, attempt: 2 });
    await listener({ type: 'model_call_attempt_ended', executionId: 'execution:1', turn: 1, attempt: 2, outcome: 'succeeded' });
    await listener({ type: 'turn_end', executionId: 'execution:1', message: assistant([{ type: 'text', text: 'final' }], 'stop'), toolResults: [] });

    expect(published.map((event) => event.type)).not.toContain('turn.retry.started');
  });
});
