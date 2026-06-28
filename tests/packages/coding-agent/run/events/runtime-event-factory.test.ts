import { describe, expect, it } from 'vitest';

import {
  createCheckpointCreatedEvent,
  createRunCancelRequestedEvent,
  createRunRetryRequestedEvent,
  createRunResumeRequestedEvent,
} from '@megumi/coding-agent/events';

describe('core recovery runtime events', () => {
  it('creates recovery events with core source and required persistence', () => {
    const base = {
      eventId: 'event_123',
      sessionId: 'session_123',
      runId: 'run_123',
      sequence: 1,
      createdAt: '2026-05-16T10:00:00.000Z',
    };

    expect(
      createCheckpointCreatedEvent(base, {
        checkpointId: 'checkpoint_123',
        reason: 'step_completed',
        boundary: 'step_boundary',
        stateSummary: 'Completed step.',
      }),
    ).toMatchObject({
      eventType: 'checkpoint.created',
      source: 'core',
      persist: 'required',
    });

    expect(
      createRunResumeRequestedEvent(base, {
        resumeRequestId: 'resume_request_123',
        requestedBy: 'user',
        reason: 'manual_resume',
        resumeMode: 'from_checkpoint',
      }).eventType,
    ).toBe('run.resume.requested');

    expect(
      createRunCancelRequestedEvent(base, {
        cancelRequestId: 'cancel_request_123',
        requestedBy: 'user',
        reason: 'user_requested',
        scope: 'run',
      }).eventType,
    ).toBe('run.cancel.requested');

    expect(
      createRunRetryRequestedEvent(base, {
        retryRequestId: 'retry_request_123',
        requestedBy: 'runtime',
        retryKind: 'retry_action',
        reason: 'runtime_error',
      }).eventType,
    ).toBe('run.retry.requested');
  });
});

