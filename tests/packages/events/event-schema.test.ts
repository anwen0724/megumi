/*
 * Verifies the event schema at its public seam: every lifecycle layer's
 * payload validates, invalid payloads are rejected, and the strict envelope
 * rejects anything the domain did not define (single-fact rule: turn.ended
 * carries references only, never content).
 */
import { describe, expect, it } from 'vitest';
import { EventSchema } from '../../../packages/agent/events/src/event-schema';

function completeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt:1',
    sessionId: 'session:1',
    executionId: 'run:1',
    sequence: 1,
    createdAt: '2026-08-04T00:00:00.000Z',
    ...overrides,
  };
}

describe('EventSchema', () => {
  it('accepts a complete event from each lifecycle layer', () => {
    const valid = [
      completeEvent({ type: 'run.started', payload: { requestId: 'req:1', providerId: 'provider:1', modelId: 'model:1' } }),
      completeEvent({ type: 'run.cancel.requested', payload: { requestedBy: 'user', reason: 'user_cancelled', scope: 'run' } }),
      completeEvent({ type: 'run.ended', payload: { status: 'failed', error: { message: 'boom' } } }),
      completeEvent({ type: 'turn.started', payload: { messageId: 'message:1' } }),
      completeEvent({ type: 'turn.ended', payload: { stopReason: 'tool_calls', messageId: 'message:1', toolCallIds: ['call:1'] } }),
      completeEvent({ type: 'turn.retry.started', payload: { attemptNumber: 2, retryKind: 'model_call' } }),
      completeEvent({ type: 'turn.retry.completed', payload: { attemptNumber: 2 } }),
      completeEvent({ type: 'turn.retry.failed', payload: { attemptNumber: 2, error: { message: 'retry exhausted' } } }),
      completeEvent({ type: 'message.started', payload: { role: 'user', messageId: 'message:1' } }),
      completeEvent({ type: 'message.update', payload: { role: 'assistant', messageId: 'message:2', content: 'hel' } }),
      completeEvent({ type: 'message.thinking.update', payload: { messageId: 'message:2', thinking: 'ponder…' } }),
      completeEvent({ type: 'message.ended', payload: { role: 'assistant', messageId: 'message:2', content: 'hello' } }),
      completeEvent({ type: 'tool_execution.requested', payload: { toolCallId: 'call:1', toolName: 'read_file', args: { path: '/a' }, modelCallId: 'model-call:1' } }),
      completeEvent({ type: 'tool_execution.started', payload: { toolCallId: 'call:1', toolName: 'bash', args: {}, toolExecutionId: 'exec:1' } }),
      completeEvent({ type: 'tool_execution.ended', payload: { toolCallId: 'call:1', toolExecutionId: 'exec:1', status: 'completed', result: 'ok', summary: 'Read 12 characters' } }),
      completeEvent({ type: 'tool_execution.ended', payload: { toolCallId: 'call:1', status: 'denied' } }),
      completeEvent({ type: 'approval.requested', payload: {
        toolCallId: 'call:1', toolName: 'bash',
        toolIdentity: { sourceId: 'built_in', namespace: 'megumi', sourceToolName: 'bash' },
        reason: 'dangerous', args: {}, operations: [{ action: 'run' }], approvalRequestId: 'approval:1',
        options: [{ optionId: 'once', scope: 'once', label: 'Once', description: 'this time only' }],
        defaultOptionId: 'once',
      } }),
      completeEvent({ type: 'approval.resolved', payload: {
        approvalRequestId: 'approval:1', toolCallId: 'call:1', decision: 'approved',
        optionId: 'once', decidedAt: '2026-08-04T00:00:00.000Z',
      } }),
      completeEvent({ type: 'approval.resolved', payload: {
        approvalRequestId: 'approval:1', toolCallId: 'call:1', decision: 'denied',
        decidedAt: '2026-08-04T00:00:00.000Z',
      } }),
      completeEvent({ type: 'approval.resolved', payload: {
        approvalRequestId: 'approval:1', toolCallId: 'call:1', decision: 'expired',
        decidedAt: '2026-08-04T00:00:00.000Z',
      } }),
      completeEvent({ type: 'approval.resolved', payload: {
        approvalRequestId: 'approval:1', toolCallId: 'call:1', decision: 'cancelled',
        decidedAt: '2026-08-04T00:00:00.000Z',
      } }),
      completeEvent({ type: 'tool_execution.plan_updated', payload: {
        toolCallId: 'call:1',
        explanation: 'modify file',
        plan: [{ step: 'edit a', status: 'pending' }],
      } }),
      completeEvent({ type: 'session.branch_marker.created', payload: { markerId: 'marker:1' } }),
      completeEvent({ type: 'session.compaction.started', payload: { trigger: 'manual', compactionId: 'compaction:1' } }),
      completeEvent({ type: 'session.compaction.ended', payload: { status: 'completed', compactionId: 'compaction:1' } }),
      completeEvent({ type: 'session.compaction.ended', payload: { status: 'failed', compactionId: 'compaction:1', error: { message: 'overflow' } } }),
      completeEvent({ type: 'session.compaction.ended', payload: { status: 'cancelled', compactionId: 'compaction:1' } }),
      completeEvent({ type: 'session.compaction.ended', payload: { status: 'interrupted', compactionId: 'compaction:1', error: { message: 'runtime stopped' } } }),
    ];
    for (const event of valid) {
      expect(EventSchema.safeParse(event).success, JSON.stringify(event)).toBe(true);
    }
  });

  it('accepts a session-scoped event without executionId', () => {
    const event = completeEvent({
      type: 'session.branch_marker.created',
      payload: { markerId: 'marker:1' },
      executionId: undefined,
    });
    expect(EventSchema.safeParse(event).success).toBe(true);
  });

  it('rejects an invalid run.cancel.requested payload', () => {
    const event = completeEvent({ type: 'run.cancel.requested', payload: { requestedBy: 'system' } });
    expect(EventSchema.safeParse(event).success).toBe(false);
  });

  it('rejects an unknown event type', () => {
    const event = completeEvent({ type: 'run.completed', payload: {} });
    expect(EventSchema.safeParse(event).success).toBe(false);
  });

  it('rejects an invalid payload value', () => {
    const event = completeEvent({ type: 'run.ended', payload: { status: 'suspended' } });
    expect(EventSchema.safeParse(event).success).toBe(false);
  });

  it('rejects extra payload fields (strict): turn.ended carries references only', () => {
    const event = completeEvent({
      type: 'turn.ended',
      payload: { stopReason: 'completed', messageId: 'message:1', toolCallIds: [], content: 'should not be here' },
    });
    expect(EventSchema.safeParse(event).success).toBe(false);
  });

  it('rejects an invalid envelope: non-positive sequence and bad id characters', () => {
    expect(EventSchema.safeParse(completeEvent({
      type: 'run.started',
      payload: { requestId: 'req:1' },
      sequence: 0,
    })).success).toBe(false);

    expect(EventSchema.safeParse(completeEvent({
      type: 'run.started',
      payload: { requestId: 'req:1' },
      id: 'bad id with spaces',
    })).success).toBe(false);
  });

  it('rejects a missing sessionId (ownership root is required)', () => {
    expect(EventSchema.safeParse(completeEvent({
      type: 'run.started',
      payload: { requestId: 'req:1' },
      sessionId: undefined,
    })).success).toBe(false);
  });
});
