// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createApprovalResolvedRuntimeEvent } from '@megumi/coding-agent/run';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model';

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
});
