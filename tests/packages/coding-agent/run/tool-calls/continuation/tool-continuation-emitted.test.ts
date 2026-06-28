// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { markToolContinuationEmitted } from '@megumi/coding-agent/run';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model';
import type { ToolResult } from '@megumi/shared/tool';

function request(): ModelStepRuntimeRequest {
  return {
    requestId: 'request-1',
    runId: 'run-1',
    sessionId: 'session-1',
    stepId: 'step-1',
    modelStepId: 'model-step-1',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    inputContext: {
      contextId: 'context-1',
      runId: 'run-1',
      sessionId: 'session-1',
      stepId: 'step-1',
      modelStepId: 'model-step-1',
      builtAt: '2026-06-14T00:00:01.000Z',
      budget: {
        maxTokens: 8_000,
        reservedTokens: 1_000,
      },
      parts: [],
      trace: {
        traceId: 'trace-1',
        items: [],
      },
    },
    createdAt: '2026-06-14T00:00:01.000Z',
  } as unknown as ModelStepRuntimeRequest;
}

describe('tool continuation emitted event owner', () => {
  it('marks unique tool executions and returns a continuation emitted runtime event', () => {
    const marked: Array<{ toolExecutionIds: string[]; emittedAt: string }> = [];

    const event = markToolContinuationEmitted({
      request: request(),
      stepId: 'step-2',
      sequence: 7,
      emittedAt: '2026-06-14T00:00:10.000Z',
      toolResults: [
        toolResult('tool-result-1', 'tool-execution-1', 'assistant-message-1'),
        toolResult('tool-result-2', 'tool-execution-1', 'assistant-message-1'),
        toolResult('tool-result-3', 'tool-execution-2', 'assistant-message-1'),
      ],
      repository: {
        markToolContinuationEmitted: (input) => {
          marked.push(input);
        },
      },
      ids: {
        eventId: () => 'event-1',
      },
    });

    expect(marked).toEqual([{
      toolExecutionIds: ['tool-execution-1', 'tool-execution-2'],
      emittedAt: '2026-06-14T00:00:10.000Z',
    }]);
    expect(event).toMatchObject({
      eventId: 'event-1',
      eventType: 'tool.continuation.emitted',
      runId: 'run-1',
      sessionId: 'session-1',
      stepId: 'step-2',
      requestId: 'request-1',
      sequence: 7,
      createdAt: '2026-06-14T00:00:10.000Z',
      source: 'tool',
      visibility: 'system',
      persist: 'required',
      payload: {
        assistantMessageId: 'assistant-message-1',
        toolExecutionIds: ['tool-execution-1', 'tool-execution-2'],
        emittedAt: '2026-06-14T00:00:10.000Z',
      },
    });
  });

  it('returns undefined when no tool execution ids can be marked', () => {
    const marked: Array<{ toolExecutionIds: string[]; emittedAt: string }> = [];

    const event = markToolContinuationEmitted({
      request: request(),
      stepId: 'step-2',
      sequence: 7,
      emittedAt: '2026-06-14T00:00:10.000Z',
      toolResults: [toolResult('tool-result-1', undefined, undefined)],
      repository: {
        markToolContinuationEmitted: (input) => {
          marked.push(input);
        },
      },
      ids: {
        eventId: () => 'event-1',
      },
    });

    expect(event).toBeUndefined();
    expect(marked).toEqual([]);
  });
});

function toolResult(
  toolResultId: string,
  toolExecutionId: string | undefined,
  assistantMessageId: string | undefined,
): ToolResult {
  return {
    toolResultId,
    toolCallId: `tool-call-${toolResultId}`,
    ...(toolExecutionId ? { toolExecutionId } : {}),
    runId: 'run-1',
    modelStepId: 'model-step-1',
    toolName: 'read_file',
    kind: 'text',
    status: 'success',
    textContent: `result text for ${toolResultId}`,
    redactionState: 'none',
    createdAt: '2026-06-14T00:00:03.000Z',
    metadata: {
      ...(assistantMessageId ? { assistantMessageId } : {}),
    },
  } as unknown as ToolResult;
}
