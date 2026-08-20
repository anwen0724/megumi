/* Verifies the complete multi-turn state machine through the package-internal Agent Loop seam. */
import { describe, expect, it, vi } from 'vitest';
import {
  AssistantMessageEventStream,
  Type,
  type Api,
  type AssistantMessage,
  type Model,
  type UserMessage,
} from '@megumi/ai';
import { runAgentLoop } from '../../../packages/agent/src/agent-loop';
import type {
  AgentConfiguration,
  AgentEvent,
  AgentPolicy,
  AgentTool,
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

const policy: AgentPolicy = {
  maxModelCalls: 4,
  maxModelCallAttempts: 1,
  maxToolRounds: 3,
  maxToolCalls: 8,
  maxToolCallsPerModelCall: 4,
  maxConcurrentToolCalls: 2,
  modelCallTimeoutMs: 1_000,
  toolCallTimeoutMs: 1_000,
  modelRetryDelayMs: 0,
  maxContextOverflowRecoveries: 0,
};

function assistant(
  content: AssistantMessage['content'],
  stopReason: AssistantMessage['stopReason'],
  timestamp: number,
): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp,
  };
}

function completedStream(message: AssistantMessage): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  const partial = { ...message, content: [] };
  stream.push({ type: 'start', partial });
  stream.push({ type: 'text_delta', contentIndex: 0, delta: 'done', partial: message });
  stream.push({
    type: 'done',
    reason: message.stopReason as 'stop' | 'toolUse',
    message,
  });
  stream.end();
  return stream;
}

function configuration(tools: readonly AgentTool[] = []): AgentConfiguration {
  return { systemPrompt: 'Be concise.', model, thinkingLevel: 'off', tools };
}

describe('Agent Loop', () => {
  it('completes one turn without ToolCalls and emits a complete ordered lifecycle', async () => {
    const input: UserMessage = { role: 'user', content: 'Hello', timestamp: 1 };
    const finalMessage = assistant([{ type: 'text', text: 'Hi' }], 'stop', 2);
    const events: AgentEvent[] = [];

    const result = await runAgentLoop({
      configuration: configuration(),
      messages: [],
      input: [input],
      stream: () => completedStream(finalMessage),
      signal: new AbortController().signal,
      policy,
      emit: async (event) => { events.push(event); },
    });

    expect(result).toEqual({
      status: 'completed',
      newMessages: [input, finalMessage],
      finalMessage,
    });
    expect(events.map((event) => event.type)).toEqual([
      'agent_start',
      'message_start',
      'message_end',
      'turn_start',
      'message_start',
      'message_update',
      'message_end',
      'turn_end',
      'agent_end',
    ]);
    expect(events.at(-1)).toEqual({ type: 'agent_end', result });
  });

  it('feeds ordered ToolResults into the next ModelCall and returns the two-turn message closure', async () => {
    const input: UserMessage = { role: 'user', content: 'Look up both.', timestamp: 1 };
    const toolMessage = assistant([
      { type: 'toolCall', id: 'call-1', name: 'lookup', arguments: { value: 'a' } },
      { type: 'toolCall', id: 'call-2', name: 'lookup', arguments: { value: 'b' } },
    ], 'toolUse', 2);
    const finalMessage = assistant([{ type: 'text', text: 'Finished' }], 'stop', 5);
    const contexts: Array<readonly unknown[]> = [];
    const streams = [completedStream(toolMessage), completedStream(finalMessage)];
    const lookup: AgentTool = {
      name: 'lookup',
      description: 'Lookup a value.',
      parameters: Type.Object({ value: Type.String() }),
      executionMode: 'parallel',
      execute: async ({ arguments: argumentsValue }) => ({
        status: 'completed',
        result: {
          content: [{ type: 'text', text: (argumentsValue as { value: string }).value }],
          isError: false,
        },
      }),
    };

    const result = await runAgentLoop({
      configuration: configuration([lookup]),
      messages: [],
      input: [input],
      stream: (_model, context) => {
        contexts.push(context.messages);
        return streams.shift()!;
      },
      signal: new AbortController().signal,
      policy,
      emit: async () => undefined,
    });

    expect(result.status).toBe('completed');
    expect(result.newMessages.map((message) => message.role)).toEqual([
      'user', 'assistant', 'toolResult', 'toolResult', 'assistant',
    ]);
    expect(contexts).toHaveLength(2);
    expect(contexts[1].map((message) => (message as { role: string }).role)).toEqual([
      'user', 'assistant', 'toolResult', 'toolResult',
    ]);
    expect(result.newMessages
      .filter((message) => message.role === 'toolResult')
      .map((message) => message.toolCallId)).toEqual(['call-1', 'call-2']);
  });

  it.each([
    ['per-model ToolCall', { maxToolCallsPerModelCall: 1 }],
    ['total ToolCall', { maxToolCalls: 1 }],
  ])('fails before starting Tools when the %s limit is reached', async (_name, patch) => {
    const toolMessage = assistant([
      { type: 'toolCall', id: 'call-1', name: 'lookup', arguments: { value: 'a' } },
      { type: 'toolCall', id: 'call-2', name: 'lookup', arguments: { value: 'b' } },
    ], 'toolUse', 2);
    const execute = vi.fn<AgentTool['execute']>(async () => ({
      status: 'completed',
      result: { content: [{ type: 'text', text: 'unused' }], isError: false },
    }));

    const result = await runAgentLoop({
      configuration: configuration([{
        name: 'lookup',
        description: 'Lookup a value.',
        parameters: Type.Object({ value: Type.String() }),
        execute,
      }]),
      messages: [],
      input: [],
      stream: () => completedStream(toolMessage),
      signal: new AbortController().signal,
      policy: { ...policy, ...patch },
      emit: async () => undefined,
    });

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'execution_limit_reached' },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('fails at the ModelCall limit without starting another turn', async () => {
    const toolMessage = assistant([
      { type: 'toolCall', id: 'call-1', name: 'lookup', arguments: {} },
    ], 'toolUse', 2);
    const stream = vi.fn(() => completedStream(toolMessage));

    const result = await runAgentLoop({
      configuration: configuration([{
        name: 'lookup',
        description: 'Lookup.',
        parameters: Type.Object({}),
        execute: async () => ({
          status: 'completed',
          result: { content: [{ type: 'text', text: 'done' }], isError: false },
        }),
      }]),
      messages: [],
      input: [],
      stream,
      signal: new AbortController().signal,
      policy: { ...policy, maxModelCalls: 1 },
      emit: async () => undefined,
    });

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'execution_limit_reached', message: 'ModelCall limit reached.' },
    });
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it('fails at the Tool round limit without starting the next Tool batch', async () => {
    const first = assistant([
      { type: 'toolCall', id: 'call-1', name: 'lookup', arguments: {} },
    ], 'toolUse', 2);
    const second = assistant([
      { type: 'toolCall', id: 'call-2', name: 'lookup', arguments: {} },
    ], 'toolUse', 4);
    const streams = [completedStream(first), completedStream(second)];
    const execute = vi.fn<AgentTool['execute']>(async () => ({
      status: 'completed',
      result: { content: [{ type: 'text', text: 'done' }], isError: false },
    }));

    const result = await runAgentLoop({
      configuration: configuration([{
        name: 'lookup',
        description: 'Lookup.',
        parameters: Type.Object({}),
        execute,
      }]),
      messages: [],
      input: [],
      stream: () => streams.shift()!,
      signal: new AbortController().signal,
      policy: { ...policy, maxToolRounds: 1 },
      emit: async () => undefined,
    });

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'execution_limit_reached', message: 'Tool round limit reached.' },
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('returns one Tool system failure and never starts a later turn', async () => {
    const toolMessage = assistant([
      { type: 'toolCall', id: 'call-1', name: 'lookup', arguments: {} },
    ], 'toolUse', 2);
    const stream = vi.fn(() => completedStream(toolMessage));

    const result = await runAgentLoop({
      configuration: configuration([{
        name: 'lookup',
        description: 'Lookup.',
        parameters: Type.Object({}),
        execute: async () => ({
          status: 'system_failed',
          error: {
            code: 'tool_system_failed',
            message: 'registry unavailable',
            retryable: false,
          },
        }),
      }]),
      messages: [],
      input: [],
      stream,
      signal: new AbortController().signal,
      policy,
      emit: async () => undefined,
    });

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'tool_system_failed' },
    });
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it('does not start another ModelCall after cancellation during a Tool', async () => {
    const controller = new AbortController();
    const toolMessage = assistant([
      { type: 'toolCall', id: 'call-1', name: 'cancel', arguments: {} },
    ], 'toolUse', 2);
    const stream = vi.fn(() => completedStream(toolMessage));

    const result = await runAgentLoop({
      configuration: configuration([{
        name: 'cancel',
        description: 'Cancel.',
        parameters: Type.Object({}),
        execute: async () => {
          controller.abort();
          return new Promise(() => undefined);
        },
      }]),
      messages: [],
      input: [],
      stream,
      signal: controller.signal,
      policy,
      emit: async () => undefined,
    });

    expect(result.status).toBe('cancelled');
    expect(stream).toHaveBeenCalledTimes(1);
    expect(result.newMessages.map((message) => message.role)).toEqual([
      'assistant', 'toolResult',
    ]);
  });

  it('converts an Event sink failure into one failed execution and still ends last', async () => {
    const events: AgentEvent[] = [];
    let failedOnce = false;
    const result = await runAgentLoop({
      configuration: configuration(),
      messages: [],
      input: [],
      stream: () => completedStream(assistant([{ type: 'text', text: 'unused' }], 'stop', 2)),
      signal: new AbortController().signal,
      policy,
      emit: async (event) => {
        events.push(event);
        if (event.type === 'turn_start' && !failedOnce) {
          failedOnce = true;
          throw new Error('listener exploded');
        }
      },
    });

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'event_listener_failed' },
    });
    expect(events.at(-1)?.type).toBe('agent_end');
    expect(events.filter((event) => event.type === 'agent_end')).toHaveLength(1);
  });
});
