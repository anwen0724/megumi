import { describe, expect, it } from 'vitest';

import { createDatabase } from '@megumi/coding-agent/persistence/connection';
import { migrateDatabase } from '@megumi/coding-agent/persistence/schema/migrations';
import { RecoveryRepository } from '@megumi/coding-agent/persistence/repos/recovery.repo';
import { RunRecordRepository } from '@megumi/coding-agent/persistence/repos/run-record.repo';
import { SessionRecordRepository } from '@megumi/coding-agent/persistence/repos/session-record.repo';
import type {
  CancelRequest,
  Checkpoint,
  ResumeRequest,
  RetryRequest,
  CheckpointRestoreRecord,
} from '@megumi/shared/recovery';
import type { Run, Session } from '@megumi/shared/session';

interface SessionRunSeedRepository {
  getRun(runId: string): Run | undefined;
  saveRun(run: Run): Run;
  saveSession(session: Session): Session;
}

function createRepository(): RecoveryRepository {
  const database = createDatabase(':memory:');
  migrateDatabase(database);
  return new RecoveryRepository(database);
}

function createRepositories(): {
  recoveryRepository: RecoveryRepository;
  sessionRunRepository: SessionRunSeedRepository;
} {
  const database = createDatabase(':memory:');
  migrateDatabase(database);
  const runRecordRepository = new RunRecordRepository(database);
  const sessionRecordRepository = new SessionRecordRepository(database);
  return {
    recoveryRepository: new RecoveryRepository(database),
    sessionRunRepository: {
      getRun: (runId) => runRecordRepository.getRun(runId),
      saveRun: (run) => runRecordRepository.saveRun(run),
      saveSession: (session) => sessionRecordRepository.saveSession(session),
    },
  };
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
    permissionSnapshotRef: overrides.permissionSnapshotRef,
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

function seedSessionRun(
  sessionRunRepository: SessionRunSeedRepository,
  input: {
    runId: string;
    sessionId?: string;
    sessionTitle?: string;
    status: Run['status'];
    goal?: string;
    createdAt?: string;
    error?: Run['error'];
  },
): void {
  const sessionId = input.sessionId ?? 'session_123';
  sessionRunRepository.saveSession({
    sessionId,
    title: input.sessionTitle ?? 'Recoverable session',
    status: 'active',
    createdAt: '2026-06-01T09:00:00.000Z',
    updatedAt: '2026-06-01T09:00:00.000Z',
  });
  sessionRunRepository.saveRun({
    runId: input.runId,
    sessionId,
    mode: 'chat',
    goal: input.goal ?? `Goal for ${input.runId}`,
    status: input.status,
    createdAt: input.createdAt ?? '2026-06-01T09:01:00.000Z',
    ...(input.error ? { error: input.error } : {}),
  });
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

  it('lists recoverable runs from persisted run state and latest checkpoint', () => {
    const { recoveryRepository, sessionRunRepository } = createRepositories();

    seedSessionRun(sessionRunRepository, {
      runId: 'run_waiting',
      sessionId: 'session_waiting',
      status: 'waiting_for_approval',
      sessionTitle: 'Approval needed',
      goal: 'Approve shell command',
      createdAt: '2026-06-01T10:00:00.000Z',
    });
    seedSessionRun(sessionRunRepository, {
      runId: 'run_failed',
      sessionId: 'session_failed',
      status: 'failed',
      sessionTitle: 'Failed session',
      goal: 'Retry provider call',
      createdAt: '2026-06-01T10:01:00.000Z',
      error: {
        code: 'provider_network_error',
        message: 'Provider stream timed out.',
        severity: 'error',
        retryable: true,
        source: 'provider',
      },
    });
    seedSessionRun(sessionRunRepository, {
      runId: 'run_completed',
      sessionId: 'session_completed',
      status: 'completed',
      createdAt: '2026-06-01T10:02:00.000Z',
    });
    recoveryRepository.saveCheckpoint(checkpoint({
      checkpointId: 'checkpoint_old',
      runId: 'run_failed',
      sequence: 1,
      createdAt: '2026-06-01T10:01:30.000Z',
    }));
    recoveryRepository.saveCheckpoint(checkpoint({
      checkpointId: 'checkpoint_latest',
      runId: 'run_failed',
      sequence: 2,
      createdAt: '2026-06-01T10:01:45.000Z',
    }));

    expect(recoveryRepository.listRecoverableRuns()).toEqual([
      expect.objectContaining({
        runId: 'run_waiting',
        sessionId: 'session_waiting',
        status: 'waiting_for_approval',
        reason: 'waiting_for_approval',
        title: 'Approval needed',
        preview: 'Approve shell command',
      }),
      expect.objectContaining({
        runId: 'run_failed',
        sessionId: 'session_failed',
        status: 'failed',
        reason: 'failed',
        latestCheckpointId: 'checkpoint_latest',
        latestCheckpointAt: '2026-06-01T10:01:45.000Z',
        title: 'Failed session',
        preview: 'Retry provider call',
      }),
    ]);
  });

  it('does not list live running-like runs until they are marked interrupted', () => {
    const { recoveryRepository, sessionRunRepository } = createRepositories();

    for (const [runId, status] of [
      ['run_queued', 'queued'],
      ['run_running', 'running'],
      ['run_cancelling', 'cancelling'],
    ] as const) {
      seedSessionRun(sessionRunRepository, {
        runId,
        status,
        goal: `Live ${runId}`,
        createdAt: '2026-06-01T10:00:00.000Z',
      });
    }

    expect(recoveryRepository.listRecoverableRuns()).toEqual([]);
  });

  it('marks stale running-like runs as interrupted without changing waiting approval', () => {
    const { recoveryRepository, sessionRunRepository } = createRepositories();

    for (const [runId, status] of [
      ['run_queued', 'queued'],
      ['run_running', 'running'],
      ['run_cancelling', 'cancelling'],
      ['run_waiting', 'waiting_for_approval'],
    ] as const) {
      seedSessionRun(sessionRunRepository, {
        runId,
        status,
        goal: `Goal for ${runId}`,
        createdAt: `2026-06-01T10:0${runId === 'run_waiting' ? 4 : runId === 'run_cancelling' ? 3 : runId === 'run_running' ? 2 : 1}:00.000Z`,
      });
    }

    const markers = recoveryRepository.markInterruptedRuns({
      markedAt: '2026-06-01T11:00:00.000Z',
      reason: 'app_restarted',
      createMarkerId: (runId) => `interrupted_${runId}`,
    });

    expect(markers).toEqual([
      expect.objectContaining({
        interruptedMarkerId: 'interrupted_run_queued',
        runId: 'run_queued',
        previousStatus: 'queued',
        reason: 'app_restarted',
      }),
      expect.objectContaining({
        interruptedMarkerId: 'interrupted_run_running',
        runId: 'run_running',
        previousStatus: 'running',
        reason: 'app_restarted',
      }),
      expect.objectContaining({
        interruptedMarkerId: 'interrupted_run_cancelling',
        runId: 'run_cancelling',
        previousStatus: 'cancelling',
        reason: 'app_restarted',
      }),
    ]);
    expect(sessionRunRepository.getRun('run_waiting')?.status).toBe('waiting_for_approval');
    expect(recoveryRepository.listRecoverableRuns()).toEqual([
      expect.objectContaining({
        runId: 'run_queued',
        status: 'queued',
        reason: 'interrupted',
        metadata: { interruptedMarkerId: 'interrupted_run_queued' },
      }),
      expect.objectContaining({
        runId: 'run_running',
        status: 'running',
        reason: 'interrupted',
        metadata: { interruptedMarkerId: 'interrupted_run_running' },
      }),
      expect.objectContaining({
        runId: 'run_cancelling',
        status: 'cancelling',
        reason: 'interrupted',
        metadata: { interruptedMarkerId: 'interrupted_run_cancelling' },
      }),
      expect.objectContaining({
        runId: 'run_waiting',
        status: 'waiting_for_approval',
        reason: 'waiting_for_approval',
      }),
    ]);
    expect(recoveryRepository.markInterruptedRuns({
      markedAt: '2026-06-01T11:01:00.000Z',
      reason: 'app_restarted',
      createMarkerId: (runId) => `interrupted_again_${runId}`,
    })).toEqual([]);
  });
});

