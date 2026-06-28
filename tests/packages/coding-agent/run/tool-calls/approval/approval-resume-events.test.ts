// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  collectApprovalResumeRuntimeEvents,
  createApprovalResolvedRuntimeEvent,
} from '@megumi/coding-agent/run/tool-calls/approval/approval-resume-events';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model';
import type { RuntimeEvent } from '@megumi/shared/runtime';
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

describe('approval resume events', () => {
  it('creates approval resolved events with request metadata', () => {
    const event = createApprovalResolvedRuntimeEvent({
      request: request(),
      stepId: 'step-1',
      sequence: 9,
      approvalRequestId: 'approval-request-1',
      decision: 'approved',
      scope: 'once',
      decidedAt: '2026-06-14T00:00:10.000Z',
      ids: { eventId: () => 'event-1' },
    });

    expect(event).toMatchObject({
      eventId: 'event-1',
      eventType: 'approval.resolved',
      runId: 'run-1',
      sessionId: 'session-1',
      stepId: 'step-1',
      requestId: 'request-1',
      sequence: 9,
      createdAt: '2026-06-14T00:00:10.000Z',
      source: 'approval',
      visibility: 'user',
      persist: 'required',
      payload: {
        approvalRequestId: 'approval-request-1',
        decision: 'approved',
        scope: 'once',
        decidedAt: '2026-06-14T00:00:10.000Z',
      },
    });
  });

  it('collects resume runtime events and adds missing tool result fallback events', () => {
    const result = collectApprovalResumeRuntimeEvents({
      request: request(),
      stepId: 'step-1',
      lastSequence: 10,
      outcome: {
        runtimeEvents: [toolResultCreatedEvent('tool-result-1')],
      },
      toolResults: [
        toolResult('tool-result-1', 'tool-call-1'),
        toolResult('tool-result-2', 'tool-call-2'),
      ],
      ids: {
        eventId: (() => {
          let index = 1;
          return () => `generated-event-${index++}`;
        })(),
      },
    });

    expect(result.lastSequence).toBe(12);
    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toMatchObject({
      eventId: 'event-existing-tool-result-1',
      eventType: 'tool.result.created',
      requestId: 'request-1',
      sequence: 11,
      payload: {
        toolResultId: 'tool-result-1',
      },
    });
    expect(result.events[1]).toMatchObject({
      eventId: 'generated-event-1',
      eventType: 'tool.result.created',
      requestId: 'request-1',
      sequence: 12,
      payload: {
        toolResultId: 'tool-result-2',
        toolCallId: 'tool-call-2',
        summary: 'result text for tool-result-2',
      },
    });
  });
});

function toolResultCreatedEvent(toolResultId: string): RuntimeEvent {
  return {
    schemaVersion: 1,
    eventId: `event-existing-${toolResultId}`,
    eventType: 'tool.result.created',
    runId: 'run-1',
    sessionId: 'session-1',
    stepId: 'step-1',
    sequence: 0,
    createdAt: '2026-06-14T00:00:02.000Z',
    source: 'tool',
    visibility: 'system',
    persist: 'required',
    payload: {
      toolResultId,
      toolCallId: 'tool-call-existing',
      kind: 'text',
      summary: 'existing result',
    },
  };
}

function toolResult(toolResultId: string, toolCallId: string): ToolResult {
  return {
    toolResultId,
    toolCallId,
    toolExecutionId: `tool-execution-${toolResultId}`,
    runId: 'run-1',
    modelStepId: 'model-step-1',
    toolName: 'read_file',
    kind: 'text',
    status: 'success',
    textContent: `result text for ${toolResultId}`,
    redactionState: 'none',
    createdAt: '2026-06-14T00:00:03.000Z',
  } as unknown as ToolResult;
}
