import { describe, expect, it, vi } from 'vitest';

import { createRecoveryService } from '@megumi/desktop/main/services/recovery.service';
import type { RecoveryRepository } from '@megumi/db/repos/recovery.repo';
import type {
  CancelRequest,
  Checkpoint,
  RecoverableRunSummary,
  ResumeRequest,
  RetryRequest,
  CheckpointRestoreRecord,
} from '@megumi/shared/recovery-contracts';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import type { SessionInterruptedRunMarker } from '@megumi/shared/session-active-path-contracts';

function createRepository(input: {
  recoverableRuns?: RecoverableRunSummary[];
  interruptedMarkers?: SessionInterruptedRunMarker[];
} = {}): RecoveryRepository {
  const checkpoints: Checkpoint[] = [];
  const resumeRequests: ResumeRequest[] = [];
  const cancelRequests: CancelRequest[] = [];
  const retryRequests: RetryRequest[] = [];
  const restoreRecords: CheckpointRestoreRecord[] = [];
  const recoverableRuns = input.recoverableRuns ?? [];
  const interruptedMarkers = input.interruptedMarkers ?? [];

  return {
    saveCheckpoint: (checkpoint: Checkpoint) => {
      checkpoints.push(checkpoint);
      return checkpoint;
    },
    getCheckpoint: (checkpointId: string) => checkpoints.find((checkpoint) => checkpoint.checkpointId === checkpointId),
    listCheckpointsByRun: (runId: string) => checkpoints.filter((checkpoint) => checkpoint.runId === runId),
    getLatestCheckpointByRun: (runId: string) => checkpoints.filter((checkpoint) => checkpoint.runId === runId).at(-1),
    markCheckpointStatus: () => undefined,
    saveResumeRequest: (request: ResumeRequest) => {
      resumeRequests.push(request);
      return request;
    },
    listResumeRequestsByRun: () => resumeRequests,
    saveCancelRequest: (request: CancelRequest) => {
      cancelRequests.push(request);
      return request;
    },
    listCancelRequestsByRun: () => cancelRequests,
    saveRetryRequest: (request: RetryRequest) => {
      retryRequests.push(request);
      return request;
    },
    listRetryRequestsByRun: () => retryRequests,
    saveRestoreRecord: (record: CheckpointRestoreRecord) => {
      restoreRecords.push(record);
      return record;
    },
    listRestoreRecordsByRun: () => restoreRecords,
    listRecoverableRuns: () => recoverableRuns,
    markInterruptedRuns: () => interruptedMarkers,
  } as unknown as RecoveryRepository;
}

describe('RecoveryService', () => {
  it('lists recoverable runs from repository and marks stale runs at creation', () => {
    const appendRuntimeEvent = vi.fn<(event: RuntimeEvent) => void>();
    const repository = createRepository({
      recoverableRuns: [{
        runId: 'run_123',
        sessionId: 'session_123',
        status: 'waiting_for_approval',
        reason: 'waiting_for_approval',
        latestCheckpointId: 'checkpoint_123',
      }],
      interruptedMarkers: [{
        interruptedMarkerId: 'interrupted_marker_123',
        sessionId: 'session_123',
        runId: 'run_interrupted',
        previousStatus: 'running',
        reason: 'app_restarted',
        markedAt: '2026-05-16T10:00:00.000Z',
      }],
    });
    const service = createRecoveryService({
      repository,
      clock: () => new Date('2026-05-16T10:00:00.000Z'),
      ids: {
        resumeRequestId: () => 'resume_request_123',
        cancelRequestId: () => 'cancel_request_123',
        retryRequestId: () => 'retry_request_123',
        eventId: () => 'event_123',
        interruptedMarkerId: (runId) => `interrupted_marker_${runId}`,
      },
      appendRuntimeEvent,
      nextRuntimeSequence: () => 7,
    });

    expect(service.listRecoverableRuns()).toHaveLength(1);
    expect(appendRuntimeEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'event_123',
      eventType: 'run.interrupted',
      runId: 'run_interrupted',
      sessionId: 'session_123',
      sequence: 7,
      createdAt: '2026-05-16T10:00:00.000Z',
      payload: {
        interruptedMarkerId: 'interrupted_marker_123',
        previousStatus: 'running',
        reason: 'app_restarted',
      },
    }));
  });

  it('persists resume cancel and retry requests', () => {
    const repository = createRepository();
    const service = createRecoveryService({
      repository,
      clock: () => new Date('2026-05-16T10:00:00.000Z'),
      ids: {
        resumeRequestId: () => 'resume_request_123',
        cancelRequestId: () => 'cancel_request_123',
        retryRequestId: () => 'retry_request_123',
        eventId: () => 'event_123',
        interruptedMarkerId: (runId) => `interrupted_marker_${runId}`,
      },
    });

    expect(service.resumeRun({
      runId: 'run_123',
      checkpointId: 'checkpoint_123',
      requestedBy: 'user',
      reason: 'manual_resume',
      resumeMode: 'from_checkpoint',
    }).resumeRequestId).toBe('resume_request_123');

    expect(service.cancelRun({
      runId: 'run_123',
      requestedBy: 'user',
      reason: 'user_requested',
      scope: 'run',
    }).cancelRequestId).toBe('cancel_request_123');

    expect(service.retryRun({
      runId: 'run_123',
      requestedBy: 'runtime',
      retryKind: 'retry_run_from_checkpoint',
      reason: 'runtime_error',
    }).retryRequestId).toBe('retry_request_123');
  });
});
