// Locks canonical renderer runtime event schemas and rejects legacy id/type events.
import { describe, expect, it } from 'vitest';
import { RuntimeEventSchema } from '../../../../src/shared/renderer-contracts/runtime';

const base = {
  eventId: 'runtime-event-1',
  eventType: 'run.started',
  projectId: 'project-1',
  sessionId: 'session-1',
  runId: 'run-1',
  requestId: 'request-1',
  sequence: 1,
  createdAt: '2026-06-20T00:00:00.000Z',
  payload: {},
};

const approvalRequest = {
  approvalRequestId: 'approval-1',
  toolCallId: 'tool-call-1',
  runId: 'run-1',
  toolName: 'write_file',
  title: 'Approve write_file',
  summary: 'Write src/a.ts',
  preview: { action: 'write' },
  requestedScope: 'once',
  status: 'pending',
  createdAt: '2026-06-20T00:00:00.000Z',
};

describe('RuntimeEventSchema', () => {
  it('accepts canonical eventId/eventType runtime events', () => {
    expect(RuntimeEventSchema.safeParse(base).success).toBe(true);
  });

  it('rejects legacy id/type runtime event shape', () => {
    expect(RuntimeEventSchema.safeParse({
      id: 'runtime-event-legacy',
      type: 'run.started',
      createdAt: '2026-06-20T00:00:00.000Z',
      payload: {},
    }).success).toBe(false);
  });

  it('requires full approval request DTOs for approval.requested payloads', () => {
    expect(RuntimeEventSchema.safeParse({
      ...base,
      eventType: 'approval.requested',
      payload: { approvalRequest },
    }).success).toBe(true);
    expect(RuntimeEventSchema.safeParse({
      ...base,
      eventType: 'approval.requested',
      payload: { approvalRequestId: 'approval-1' },
    }).success).toBe(false);
  });

  it('requires terminal run events to carry renderer reset identifiers', () => {
    expect(RuntimeEventSchema.safeParse({
      ...base,
      eventType: 'run.completed',
      payload: { status: 'completed' },
    }).success).toBe(true);
    expect(RuntimeEventSchema.safeParse({
      eventId: 'runtime-event-2',
      eventType: 'run.completed',
      sequence: 2,
      createdAt: '2026-06-20T00:00:01.000Z',
      payload: { status: 'completed' },
    }).success).toBe(false);
  });
});
