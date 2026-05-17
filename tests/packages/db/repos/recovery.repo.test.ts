import { describe, expect, it } from 'vitest';

import { createDatabase } from '@megumi/db/connection';
import { migrateDatabase } from '@megumi/db/schema/migrations';
import { RecoveryRepository } from '@megumi/db/repos/recovery.repo';
import type {
  CancelRequest,
  Checkpoint,
  ResumeRequest,
  RetryRequest,
  CheckpointRestoreRecord,
} from '@megumi/shared/recovery-contracts';

function createRepository(): RecoveryRepository {
  const database = createDatabase(':memory:');
  migrateDatabase(database);
  return new RecoveryRepository(database);
}

function checkpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    checkpointId: overrides.checkpointId ?? 'checkpoint_123',
    runId: overrides.runId ?? 'run_123',
    stepId: overrides.stepId,
    actionId: overrides.actionId,
    reason: overrides.reason ?? 'step_completed',
    status: overrides.status ?? 'created',
    boundary: overrides.boundary ?? 'step_boundary',
    sequence: overrides.sequence ?? 1,
    schemaVersion: 1,
    createdAt: overrides.createdAt ?? '2026-05-16T10:00:00.000Z',
    createdBy: overrides.createdBy ?? 'runtime',
    modeSnapshotRef: overrides.modeSnapshotRef,
    contextBuildRef: overrides.contextBuildRef,
    policySnapshotRef: overrides.policySnapshotRef,
    toolRegistrySnapshotRef: overrides.toolRegistrySnapshotRef,
    approvalRequestId: overrides.approvalRequestId,
    toolCallId: overrides.toolCallId,
    parentCheckpointId: overrides.parentCheckpointId,
    sideEffectRefs: overrides.sideEffectRefs ?? [],
    resumeCursor: overrides.resumeCursor,
    stateSummary: overrides.stateSummary ?? 'Checkpoint after step.',
    stateRef: overrides.stateRef,
    metadata: overrides.metadata,
  };
}

describe('RecoveryRepository', () => {
  it('saves and lists checkpoints by run order', () => {
    const repository = createRepository();

    repository.saveCheckpoint(checkpoint({ checkpointId: 'checkpoint_1', sequence: 1 }));
    repository.saveCheckpoint(checkpoint({ checkpointId: 'checkpoint_2', sequence: 2 }));

    expect(repository.getCheckpoint('checkpoint_1')?.stateSummary).toBe('Checkpoint after step.');
    expect(repository.getLatestCheckpointByRun('run_123')?.checkpointId).toBe('checkpoint_2');
    expect(repository.listCheckpointsByRun('run_123').map((item) => item.checkpointId)).toEqual([
      'checkpoint_1',
      'checkpoint_2',
    ]);
  });

  it('updates checkpoint status without losing stored json fields', () => {
    const repository = createRepository();

    repository.saveCheckpoint(checkpoint({ checkpointId: 'checkpoint_1' }));
    repository.markCheckpointStatus('checkpoint_1', 'restored');

    expect(repository.getCheckpoint('checkpoint_1')?.status).toBe('restored');
  });

  it('persists control requests and restore records', () => {
    const repository = createRepository();

    const resumeRequest: ResumeRequest = {
      resumeRequestId: 'resume_request_123',
      runId: 'run_123',
      checkpointId: 'checkpoint_123',
      requestedBy: 'user',
      reason: 'manual_resume',
      resumeMode: 'from_checkpoint',
      createdAt: '2026-05-16T10:00:00.000Z',
    };

    const cancelRequest: CancelRequest = {
      cancelRequestId: 'cancel_request_123',
      runId: 'run_123',
      requestedBy: 'user',
      reason: 'user_requested',
      scope: 'run',
      createdAt: '2026-05-16T10:00:01.000Z',
    };

    const retryRequest: RetryRequest = {
      retryRequestId: 'retry_request_123',
      runId: 'run_123',
      checkpointId: 'checkpoint_123',
      requestedBy: 'runtime',
      retryKind: 'retry_run_from_checkpoint',
      reason: 'runtime_error',
      createdAt: '2026-05-16T10:00:02.000Z',
    };

    const restoreRecord: CheckpointRestoreRecord = {
      restoreRecordId: 'restore_record_123',
      runId: 'run_123',
      checkpointId: 'checkpoint_123',
      resumeRequestId: 'resume_request_123',
      status: 'restored',
      restoredAt: '2026-05-16T10:00:03.000Z',
    };

    expect(repository.saveResumeRequest(resumeRequest).resumeRequestId).toBe('resume_request_123');
    expect(repository.saveCancelRequest(cancelRequest).cancelRequestId).toBe('cancel_request_123');
    expect(repository.saveRetryRequest(retryRequest).retryRequestId).toBe('retry_request_123');
    expect(repository.saveRestoreRecord(restoreRecord).restoreRecordId).toBe('restore_record_123');

    expect(repository.listResumeRequestsByRun('run_123')).toHaveLength(1);
    expect(repository.listCancelRequestsByRun('run_123')).toHaveLength(1);
    expect(repository.listRetryRequestsByRun('run_123')).toHaveLength(1);
    expect(repository.listRestoreRecordsByRun('run_123')).toHaveLength(1);
  });
});
