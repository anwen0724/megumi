/* Verifies Agent ToolCall batches through the package-internal protocol seam. */
import { describe, expect, it, vi } from 'vitest';
import { Type, type ToolCall } from '@megumi/ai';
import { runToolCallBatch } from '../../../packages/agent-core/src/tool-call';
import type {
  AgentEvent,
  AgentTool,
  AgentToolResult,
} from '../../../packages/agent-core/src/types';

function call(id: string, name: string, argumentsValue: Record<string, unknown> = {}): ToolCall {
  return { type: 'toolCall', id, name, arguments: argumentsValue };
}

function tool(
  name: string,
  execute: AgentTool['execute'] = async () => ({
    status: 'completed',
    result: { content: [{ type: 'text', text: 'ok' }], isError: false },
  }),
  executionMode: AgentTool['executionMode'] = 'sequential',
): AgentTool {
  return {
    name,
    description: `${name} description`,
    parameters: Type.Object({ value: Type.Optional(Type.String()) }),
    executionMode,
    execute,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

describe('Agent ToolCall Batch', () => {
  it('turns unknown Tools and invalid arguments into model-visible ordered results', async () => {
    const execute = vi.fn(tool('known').execute);
    const events: AgentEvent[] = [];

    const result = await runToolCallBatch({
      calls: [
        call('call-1', 'missing'),
        call('call-2', 'known', { value: {} }),
      ],
      tools: [tool('known', execute)],
      signal: new AbortController().signal,
      executionId: 'execution:tool-1',
      policy: { maxConcurrentToolCalls: 2, toolCallTimeoutMs: 1_000 },
      emit: async (event) => { events.push(event); },
    });

    expect(result).toMatchObject({ status: 'completed' });
    expect(result.results).toHaveLength(2);
    expect(result.results.map((item) => item.toolCallId)).toEqual(['call-1', 'call-2']);
    expect(result.results.every((item) => item.isError)).toBe(true);
    expect(execute).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('executes a Tool with validated arguments and pairs start, update, and end events', async () => {
    const events: AgentEvent[] = [];
    const execute = vi.fn<AgentTool['execute']>(async ({ arguments: argumentsValue, onUpdate }) => {
      onUpdate({ content: [{ type: 'text', text: 'working' }], isError: false });
      return {
        status: 'completed',
        result: {
          content: [{ type: 'text', text: JSON.stringify(argumentsValue) }],
          details: { source: 'memory' },
          isError: false,
        },
      };
    });

    const result = await runToolCallBatch({
      calls: [call('call-1', 'known', { value: 7 })],
      tools: [tool('known', execute)],
      signal: new AbortController().signal,
      executionId: 'execution:tool-1',
      policy: { maxConcurrentToolCalls: 2, toolCallTimeoutMs: 1_000 },
      emit: async (event) => { events.push(event); },
    });

    expect(result.status).toBe('completed');
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      toolCallId: 'call-1',
      arguments: { value: '7' },
    }));
    expect(result.results[0]).toMatchObject({
      toolCallId: 'call-1',
      toolName: 'known',
      content: [{ type: 'text', text: '{"value":"7"}' }],
      details: { source: 'memory' },
      isError: false,
    });
    expect(events.map((event) => event.type)).toEqual([
      'tool_execution_start',
      'tool_execution_update',
      'tool_execution_end',
    ]);
  });

  it('removes the cancellation waiter after a Tool completes normally', async () => {
    const addListener = vi.spyOn(AbortSignal.prototype, 'addEventListener');
    const removeListener = vi.spyOn(AbortSignal.prototype, 'removeEventListener');

    const result = await runToolCallBatch({
      calls: [call('call-1', 'known')],
      tools: [tool('known')],
      signal: new AbortController().signal,
      executionId: 'execution:tool-1',
      policy: { maxConcurrentToolCalls: 1, toolCallTimeoutMs: 1_000 },
      emit: async () => undefined,
    });

    expect(result.status).toBe('completed');
    expect(removeListener.mock.calls.filter(([type]) => type === 'abort')).toHaveLength(
      addListener.mock.calls.filter(([type]) => type === 'abort').length,
    );
    addListener.mockRestore();
    removeListener.mockRestore();
  });

  it('bounds parallel windows, uses sequential calls as barriers, and preserves model order', async () => {
    const gates = new Map<string, ReturnType<typeof deferred<AgentToolResult>>>();
    const starts: string[] = [];
    let active = 0;
    let peakActive = 0;
    const execute = vi.fn<AgentTool['execute']>(async ({ toolCallId }) => {
      starts.push(toolCallId);
      active += 1;
      peakActive = Math.max(peakActive, active);
      const gate = deferred<AgentToolResult>();
      gates.set(toolCallId, gate);
      const result = await gate.promise;
      active -= 1;
      return { status: 'completed', result };
    });
    const parallel = tool('parallel', execute, 'parallel');
    const sequential = tool('sequential', execute, 'sequential');

    const batch = runToolCallBatch({
      calls: [
        call('p1', 'parallel'),
        call('p2', 'parallel'),
        call('p3', 'parallel'),
        call('s1', 'sequential'),
        call('p4', 'parallel'),
      ],
      tools: [parallel, sequential],
      signal: new AbortController().signal,
      executionId: 'execution:tool-1',
      policy: { maxConcurrentToolCalls: 2, toolCallTimeoutMs: 1_000 },
      emit: async () => undefined,
    });

    await vi.waitFor(() => expect(starts).toEqual(['p1', 'p2']));
    gates.get('p2')?.resolve({ content: [{ type: 'text', text: 'p2' }], isError: false });
    await vi.waitFor(() => expect(starts).toEqual(['p1', 'p2', 'p3']));
    gates.get('p3')?.resolve({ content: [{ type: 'text', text: 'p3' }], isError: false });
    gates.get('p1')?.resolve({ content: [{ type: 'text', text: 'p1' }], isError: false });
    await vi.waitFor(() => expect(starts).toEqual(['p1', 'p2', 'p3', 's1']));
    gates.get('s1')?.resolve({ content: [{ type: 'text', text: 's1' }], isError: false });
    await vi.waitFor(() => expect(starts).toEqual(['p1', 'p2', 'p3', 's1', 'p4']));
    gates.get('p4')?.resolve({ content: [{ type: 'text', text: 'p4' }], isError: false });

    const result = await batch;
    expect(result.status).toBe('completed');
    expect(peakActive).toBe(2);
    expect(result.results.map((message) => message.toolCallId)).toEqual([
      'p1', 'p2', 'p3', 's1', 'p4',
    ]);
  });

  it('turns an ordinary Tool exception into a model-visible error', async () => {
    const result = await runToolCallBatch({
      calls: [call('call-1', 'broken')],
      tools: [tool('broken', async () => { throw new Error('domain failure'); })],
      signal: new AbortController().signal,
      executionId: 'execution:tool-1',
      policy: { maxConcurrentToolCalls: 1, toolCallTimeoutMs: 1_000 },
      emit: async () => undefined,
    });

    expect(result.status).toBe('completed');
    expect(result.results[0]).toMatchObject({
      toolCallId: 'call-1',
      content: [{ type: 'text', text: 'domain failure' }],
      isError: true,
    });
  });

  it('stops starting calls on system failure and closes every started lifecycle', async () => {
    const events: AgentEvent[] = [];
    const starts: string[] = [];
    const execute = vi.fn<AgentTool['execute']>(async ({ toolCallId, signal }) => {
      starts.push(toolCallId);
      if (toolCallId === 'p1') {
        return {
          status: 'system_failed',
          error: {
            code: 'tool_system_failed',
            message: 'tool runtime unavailable',
            retryable: false,
          },
        };
      }
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
      return {
        status: 'completed',
        result: { content: [{ type: 'text', text: 'late' }], isError: false },
      };
    });

    const result = await runToolCallBatch({
      calls: [call('p1', 'parallel'), call('p2', 'parallel'), call('p3', 'parallel')],
      tools: [tool('parallel', execute, 'parallel')],
      signal: new AbortController().signal,
      executionId: 'execution:tool-1',
      policy: { maxConcurrentToolCalls: 2, toolCallTimeoutMs: 1_000 },
      emit: async (event) => { events.push(event); },
    });

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'tool_system_failed', message: 'tool runtime unavailable' },
    });
    expect(starts).not.toContain('p3');
    const startedIds = events
      .filter((event) => event.type === 'tool_execution_start')
      .map((event) => event.toolCallId);
    const endedIds = events
      .filter((event) => event.type === 'tool_execution_end')
      .map((event) => event.toolCallId);
    expect(endedIds).toEqual(expect.arrayContaining(startedIds));
    expect(endedIds).toHaveLength(startedIds.length);
  });

  it('settles a timed-out Tool even when the Tool ignores cancellation', async () => {
    const events: AgentEvent[] = [];
    const result = await runToolCallBatch({
      calls: [call('call-1', 'hanging')],
      tools: [tool('hanging', async () => new Promise(() => undefined))],
      signal: new AbortController().signal,
      executionId: 'execution:tool-1',
      policy: { maxConcurrentToolCalls: 1, toolCallTimeoutMs: 10 },
      emit: async (event) => { events.push(event); },
    });

    expect(result.status).toBe('completed');
    expect(result.results[0]).toMatchObject({
      toolCallId: 'call-1',
      content: [{ type: 'text', text: 'Tool call timed out.' }],
      isError: true,
    });
    expect(events.map((event) => event.type)).toEqual([
      'tool_execution_start',
      'tool_execution_end',
    ]);
  });

  it('propagates root cancellation, closes started calls, and does not start remaining calls', async () => {
    const controller = new AbortController();
    const starts: string[] = [];
    const events: AgentEvent[] = [];
    const execute = vi.fn<AgentTool['execute']>(async ({ toolCallId }) => {
      starts.push(toolCallId);
      return new Promise(() => undefined);
    });

    const batch = runToolCallBatch({
      calls: [call('s1', 'sequential'), call('s2', 'sequential')],
      tools: [tool('sequential', execute)],
      signal: controller.signal,
      executionId: 'execution:tool-1',
      policy: { maxConcurrentToolCalls: 1, toolCallTimeoutMs: 10_000 },
      emit: async (event) => { events.push(event); },
    });
    await vi.waitFor(() => expect(starts).toEqual(['s1']));
    controller.abort();

    const result = await batch;
    expect(result.status).toBe('cancelled');
    expect(starts).toEqual(['s1']);
    expect(result.results.map((message) => message.toolCallId)).toEqual(['s1', 's2']);
    expect(result.results.every((message) => message.isError)).toBe(true);
    expect(events.map((event) => event.type)).toEqual([
      'tool_execution_start',
      'tool_execution_end',
    ]);
  });
});
