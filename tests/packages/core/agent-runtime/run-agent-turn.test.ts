import { describe, expect, it } from 'vitest';
import { createAgentRunCreatedEvent } from '@megumi/core/agent-runtime/events';

describe('agent runtime lifecycle events', () => {
  it('creates run.created events with stable lifecycle payloads', () => {
    expect(createAgentRunCreatedEvent({
      eventId: 'event-1',
      runId: 'run-1',
      sessionId: 'session-1',
      sequence: 1,
      createdAt: '2026-05-15T00:00:00.000Z',
      mode: 'chat',
      goal: 'Answer',
      triggerMessageId: 'message-1',
    })).toMatchObject({
      eventType: 'run.created',
      runId: 'run-1',
      sessionId: 'session-1',
      sequence: 1,
      source: 'core',
      visibility: 'user',
      persist: 'required',
      payload: {
        status: 'queued',
        mode: 'chat',
        goal: 'Answer',
        triggerMessageId: 'message-1',
      },
    });
  });
});
