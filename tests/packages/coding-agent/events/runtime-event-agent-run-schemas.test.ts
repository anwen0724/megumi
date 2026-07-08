import { describe, expect, it } from 'vitest';
import { RuntimeEventSchema, type RuntimeEvent } from '@megumi/coding-agent/events';

function event(eventType: RuntimeEvent['eventType'], payload: Record<string, unknown>): RuntimeEvent {
  return {
    eventId: `event:${eventType.replaceAll('.', '_')}:1`,
    schemaVersion: 1,
    eventType,
    runId: 'run:1',
    sessionId: 'session:1',
    requestId: 'request:1',
    sequence: 1,
    createdAt: '2026-07-09T00:00:00.000Z',
    source: 'core',
    visibility: 'user',
    persist: 'required',
    payload,
  };
}

describe('agent run runtime event schemas', () => {
  it('accepts model call stream events', () => {
    expect(RuntimeEventSchema.safeParse(event('model_call.text_delta', {
      modelCallId: 'model-call:1',
      delta: 'hello',
    })).success).toBe(true);

    expect(RuntimeEventSchema.safeParse(event('model_call.tool_call', {
      modelCallId: 'model-call:1',
      toolCallId: 'tool-call:1',
      providerToolCallId: 'provider-tool-call:1',
      toolName: 'list_directory',
      input: { path: '.' },
    })).success).toBe(true);

    expect(RuntimeEventSchema.safeParse(event('model_call.completed', {
      modelCallId: 'model-call:1',
      finishReason: 'stop',
      content: 'done',
    })).success).toBe(true);
  });

  it('accepts tool call and tool result events', () => {
    expect(RuntimeEventSchema.safeParse(event('tool_call.started', {
      toolCallId: 'tool-call:1',
      toolExecutionId: 'tool-execution:1',
      toolName: 'list_directory',
      input: { path: '.' },
    })).success).toBe(true);

    expect(RuntimeEventSchema.safeParse(event('tool_result.created', {
      toolResultId: 'tool-result:1',
      toolCallId: 'tool-call:1',
      toolExecutionId: 'tool-execution:1',
      toolName: 'list_directory',
      kind: 'success',
      summary: 'Read directory.',
    })).success).toBe(true);

    expect(RuntimeEventSchema.safeParse(event('tool_result.created', {
      toolResultId: 'tool-result:tool-call-1',
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-call-1',
      toolName: 'read_file',
      kind: 'failed',
      summary: 'Tool execution failed.',
    })).success).toBe(true);
  });

  it('rejects missing required payload fields', () => {
    expect(RuntimeEventSchema.safeParse(event('model_call.text_delta', {
      delta: 'hello',
    })).success).toBe(false);

    expect(RuntimeEventSchema.safeParse(event('tool_result.created', {
      toolResultId: 'tool-result:1',
      kind: 'success',
      summary: 'Read directory.',
    })).success).toBe(false);
  });
});
