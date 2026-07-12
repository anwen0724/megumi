import { describe, expect, it } from 'vitest';
import { RuntimeEventSchema, type RuntimeEvent } from '@megumi/coding-agent/events';

function event(
  eventType: RuntimeEvent['eventType'],
  payload: Record<string, unknown>,
  overrides: Partial<RuntimeEvent> = {},
): RuntimeEvent {
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
    ...overrides,
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
      content: [{ type: 'text', text: 'done' }],
    })).success).toBe(true);
  });

  it('normalizes legacy transcript payloads to structured content', () => {
    const legacyCompletion = RuntimeEventSchema.parse(event('model_call.completed', {
      modelCallId: 'model-call:1',
      finishReason: 'tool_calls',
      content: 'I will inspect it.',
    }));
    const legacyResult = RuntimeEventSchema.parse(event('tool_result.created', {
      toolResultId: 'tool-result:1',
      toolCallId: 'tool-call:1',
      toolName: 'read_file',
      kind: 'success',
      summary: 'file contents',
    }));
    const legacyResultWithoutSummary = RuntimeEventSchema.parse(event('tool_result.created', {
      toolResultId: 'tool-result:2',
      toolCallId: 'tool-call:2',
      toolName: 'read_file',
      kind: 'failed',
    }));

    expect(legacyCompletion.payload).toEqual({
      modelCallId: 'model-call:1',
      finishReason: 'tool_calls',
      content: [{ type: 'text', text: 'I will inspect it.' }],
    });
    expect(legacyResult.payload).toEqual({
      toolResultId: 'tool-result:1',
      toolCallId: 'tool-call:1',
      toolName: 'read_file',
      kind: 'success',
      content: [{ type: 'text', text: 'file contents' }],
    });
    expect(legacyResultWithoutSummary.payload).toEqual({
      toolResultId: 'tool-result:2',
      toolCallId: 'tool-call:2',
      toolName: 'read_file',
      kind: 'failed',
      content: [{ type: 'text', text: '' }],
    });
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
      content: [{ type: 'text', text: 'Read directory.' }],
    })).success).toBe(true);

    expect(RuntimeEventSchema.safeParse(event('tool_result.created', {
      toolResultId: 'tool-result:tool-call-1',
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-call-1',
      toolName: 'read_file',
      kind: 'failed',
      content: [{ type: 'text', text: 'Tool execution failed.' }],
    })).success).toBe(true);
  });

  it('rejects missing required payload fields', () => {
    expect(RuntimeEventSchema.safeParse(event('model_call.text_delta', {
      delta: 'hello',
    })).success).toBe(false);

    expect(RuntimeEventSchema.safeParse(event('tool_result.created', {
      toolResultId: 'tool-result:1',
      kind: 'success',
      content: [{ type: 'text', text: 'Read directory.' }],
    })).success).toBe(false);
  });

  it('accepts session-scoped context compaction events without run ids', () => {
    expect(RuntimeEventSchema.safeParse(event('context.compaction.started', {
      compactionId: 'compaction:1',
      triggerReason: 'automatic',
      tokensBefore: 240000,
      firstKeptSourceRef: { sourceId: 'message:1', sourceKind: 'message' },
      summarizedSourceCount: 12,
    }, { runId: undefined })).success).toBe(true);

    expect(RuntimeEventSchema.safeParse(event('context.compaction.completed', {
      compactionId: 'compaction:1',
      triggerReason: 'automatic',
      tokensBefore: 240000,
      firstKeptSourceRef: { sourceId: 'message:1', sourceKind: 'message' },
      summarizedSourceCount: 12,
    }, { runId: undefined })).success).toBe(true);

    expect(RuntimeEventSchema.safeParse(event('context.compaction.failed', {
      triggerReason: 'automatic',
      tokensBefore: 240000,
      error: {
        code: 'runtime_unknown',
        message: 'Compaction failed.',
        severity: 'error',
        retryable: false,
        source: 'core',
      },
    }, { runId: undefined })).success).toBe(true);

    expect(RuntimeEventSchema.safeParse(event('context.compaction.started', {
      compactionId: 'compaction:1',
      triggerReason: 'automatic',
      tokensBefore: 240000,
      firstKeptSourceRef: { sourceId: 'message:1', sourceKind: 'message' },
      summarizedSourceCount: 12,
    }, { runId: undefined, sessionId: undefined })).success).toBe(false);
  });
});
