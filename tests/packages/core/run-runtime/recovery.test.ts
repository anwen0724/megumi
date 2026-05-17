import { describe, expect, it } from 'vitest';

import {
  createCancelObservation,
  createCheckpointObservation,
  createResumeObservation,
  createRetryObservation,
  isRecoveryObservation,
  toCheckpointCreatedPayload,
} from '@megumi/core/run-runtime/recovery';

describe('core run recovery helpers', () => {
  it('creates checkpoint observations without raw state content', () => {
    const observation = createCheckpointObservation({
      observationId: 'observation_123',
      runId: 'run_123',
      stepId: 'step_123',
      checkpointId: 'checkpoint_123',
      reason: 'step_completed',
      boundary: 'step_boundary',
      stateSummary: 'Completed model planning step.',
      receivedAt: '2026-05-16T10:00:00.000Z',
    });

    expect(observation.source).toBe('checkpoint');
    expect(observation.kind).toBe('checkpoint_created');
    expect(observation.metadata).toMatchObject({
      checkpointId: 'checkpoint_123',
      reason: 'step_completed',
      boundary: 'step_boundary',
    });
    expect(JSON.stringify(observation)).not.toContain('rawFullPrompt');
  });

  it('converts checkpoint observations to runtime event payloads', () => {
    const observation = createCheckpointObservation({
      observationId: 'observation_123',
      runId: 'run_123',
      stepId: 'step_123',
      checkpointId: 'checkpoint_123',
      reason: 'before_approval_wait',
      boundary: 'approval_boundary',
      stateSummary: 'Waiting for approval.',
      receivedAt: '2026-05-16T10:00:00.000Z',
    });

    expect(toCheckpointCreatedPayload(observation)).toEqual({
      checkpointId: 'checkpoint_123',
      reason: 'before_approval_wait',
      boundary: 'approval_boundary',
      stateSummary: 'Waiting for approval.',
    });
  });

  it('identifies resume, cancel, and retry observations', () => {
    expect(
      isRecoveryObservation(
        createResumeObservation({
          observationId: 'observation_resume',
          runId: 'run_123',
          resumeRequestId: 'resume_request_123',
          reason: 'manual_resume',
          resumeMode: 'from_checkpoint',
          receivedAt: '2026-05-16T10:00:01.000Z',
        }),
      ),
    ).toBe(true);

    expect(
      isRecoveryObservation(
        createCancelObservation({
          observationId: 'observation_cancel',
          runId: 'run_123',
          cancelRequestId: 'cancel_request_123',
          reason: 'user_requested',
          scope: 'run',
          receivedAt: '2026-05-16T10:00:02.000Z',
        }),
      ),
    ).toBe(true);

    expect(
      isRecoveryObservation(
        createRetryObservation({
          observationId: 'observation_retry',
          runId: 'run_123',
          retryRequestId: 'retry_request_123',
          retryKind: 'retry_action',
          reason: 'runtime_error',
          receivedAt: '2026-05-16T10:00:03.000Z',
        }),
      ),
    ).toBe(true);
  });
});
