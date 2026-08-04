/*
 * Verifies the event schema at its public seam: every lifecycle layer's
 * payload validates, invalid payloads are rejected, and the strict envelope
 * rejects anything the domain did not define (single-fact rule: turn.ended
 * carries references only, never content).
 */
import { describe, expect, it } from 'vitest';
import { EventSchema } from '../../../packages/events/src/event-schema';

function completeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt:1',
    sessionId: 'session:1',
    runId: 'run:1',
    sequence: 1,
    createdAt: '2026-08-04T00:00:00.000Z',
    ...overrides,
  };
}

describe('EventSchema', () => {
  it('accepts a complete event from each lifecycle layer', () => {
    const valid = [
      completeEvent({ type: 'run.started', payload: { requestId: 'req:1' } }),
      completeEvent({ type: 'run.ended', payload: { status: 'failed', error: { message: 'boom' } } }),
      completeEvent({ type: 'turn.started', payload: { messageId: 'message:1' } }),
      completeEvent({ type: 'turn.ended', payload: { stopReason: 'tool_calls', messageId: 'message:1', toolCallIds: ['call:1'] } }),
      completeEvent({ type: 'message.started', payload: { role: 'user', messageId: 'message:1' } }),
      completeEvent({ type: 'message.update', payload: { role: 'assistant', messageId: 'message:2', content: 'hel' } }),
      completeEvent({ type: 'message.ended', payload: { role: 'assistant', messageId: 'message:2', content: 'hello' } }),
      completeEvent({ type: 'tool_execution.started', payload: { toolCallId: 'call:1', toolName: 'bash', args: {} } }),
      completeEvent({ type: 'tool_execution.ended', payload: { toolCallId: 'call:1', status: 'completed', result: 'ok' } }),
      completeEvent({ type: 'approval.requested', payload: { toolCallId: 'call:1', toolName: 'bash', reason: 'dangerous', args: {}, approvalRequestId: 'approval:1' } }),
      completeEvent({ type: 'approval.resolved', payload: { toolCallId: 'call:1', decision: 'approved' } }),
      completeEvent({ type: 'branch_marker.created', payload: { markerId: 'marker:1' } }),
      completeEvent({ type: 'compaction.started', payload: { trigger: 'manual' } }),
    ];
    for (const event of valid) {
      expect(EventSchema.safeParse(event).success, JSON.stringify(event)).toBe(true);
    }
  });

  it('accepts a session-scoped event without runId', () => {
    const event = completeEvent({
      type: 'branch_marker.created',
      payload: { markerId: 'marker:1' },
      runId: undefined,
    });
    expect(EventSchema.safeParse(event).success).toBe(true);
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
