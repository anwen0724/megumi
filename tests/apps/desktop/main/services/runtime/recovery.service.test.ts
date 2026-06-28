import { describe, expect, it, vi } from 'vitest';

import { createRecoveryService } from '@megumi/coding-agent/state';
import type { RecoveryRepository } from '@megumi/coding-agent/persistence/repos/recovery.repo';
import type {
  CancelRequest,
  Checkpoint,
  RecoverableRunSummary,
  ResumeRequest,
  RetryRequest,
  CheckpointRestoreRecord,
} from '@megumi/shared/recovery';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import type { SessionInterruptedRunMarker } from '@megumi/shared/session';
import type { WorkspaceRestoreData } from '@megumi/shared/ipc';
import type { WorkspaceChangeSummary } from '@megumi/shared/workspace';

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

function createIds() {
  return {
    resumeRequestId: () => 'resume_request_123',
    cancelRequestId: () => 'cancel_request_123',
    retryRequestId: () => 'retry_request_123',
    eventId: vi.fn()
      .mockReturnValueOnce('event_workspace_restore_requested')
      .mockReturnValueOnce('event_workspace_restore_completed')
      .mockReturnValue('event_123'),
    interruptedMarkerId: (runId: string) => `interrupted_marker_${runId}`,
  };
}

function createWorkspaceRestorePort() {
  return {
    restoreChangeSet: vi.fn(async () => {
      throw new Error('Unexpected workspace restore call.');
    }),
  };
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
      workspaceRestore: createWorkspaceRestorePort(),
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
      ids: createIds(),
      workspaceRestore: createWorkspaceRestorePort(),
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

  it('attaches workspace summaries only for recoverable runs with changed files', () => {
    const runWithChanges: RecoverableRunSummary = {
      runId: 'run_with_changes',
      sessionId: 'session_123',
      status: 'failed',
      reason: 'failed',
      latestCheckpointId: 'checkpoint_123',
    };
    const runWithoutChanges: RecoverableRunSummary = {
      runId: 'run_without_changes',
      sessionId: 'session_123',
      status: 'cancelled',
      reason: 'cancelled',
      latestCheckpointId: 'checkpoint_456',
    };
    const summaryWithChanges: WorkspaceChangeSummary = {
      changeSetId: 'workspace-change-set-1',
      sessionId: 'session_123',
      runId: 'run_with_changes',
      changedFileCount: 2,
      restorableCount: 2,
      restoredCount: 0,
      conflictCount: 0,
      failedCount: 0,
      hasRestorableChanges: true,
      updatedAt: '2026-06-05T10:00:00.000Z',
    };
    const emptySummary: WorkspaceChangeSummary = {
      changeSetId: 'workspace-change-set-empty',
      sessionId: 'session_123',
      runId: 'run_without_changes',
      changedFileCount: 0,
      restorableCount: 0,
      restoredCount: 0,
      conflictCount: 0,
      failedCount: 0,
      hasRestorableChanges: false,
      updatedAt: '2026-06-05T10:00:00.000Z',
    };
    const workspaceChanges = {
      listChangeSummariesByRun: vi.fn((runId: string) => (
        runId === 'run_with_changes' ? [summaryWithChanges] : [emptySummary]
      )),
    };
    const service = createRecoveryService({
      repository: createRepository({
        recoverableRuns: [runWithChanges, runWithoutChanges],
      }),
      clock: () => new Date('2026-06-05T10:00:00.000Z'),
      ids: createIds(),
      workspaceChanges,
      workspaceRestore: {
        restoreChangeSet: vi.fn(),
      },
    });

    expect(service.listRecoverableRuns()).toEqual([{
      ...runWithChanges,
      workspaceChangeSummaries: [summaryWithChanges],
    }, runWithoutChanges]);
    expect(workspaceChanges.listChangeSummariesByRun).toHaveBeenCalledWith('run_with_changes');
    expect(workspaceChanges.listChangeSummariesByRun).toHaveBeenCalledWith('run_without_changes');
  });

  it('delegates workspace change restore and appends display-safe requested and completed events', async () => {
    const appendRuntimeEvent = vi.fn<(event: RuntimeEvent) => void>();
    const restoreData: WorkspaceRestoreData = {
      request: {
        restoreRequestId: 'workspace-restore-request-1',
        changeSetId: 'workspace-change-set-1',
        sessionId: 'session_123',
        runId: 'run_123',
        requestedBy: 'user',
        status: 'completed',
        requestedAt: '2026-06-05T10:00:00.000Z',
        completedAt: '2026-06-05T10:00:01.000Z',
        metadata: {
          rawSnapshotMarker: 'before secret should stay out of events',
        },
      },
      result: {
        restoreResultId: 'workspace-restore-result-1',
        restoreRequestId: 'workspace-restore-request-1',
        changeSetId: 'workspace-change-set-1',
        sessionId: 'session_123',
        runId: 'run_123',
        status: 'partial',
        restoredAt: '2026-06-05T10:00:01.000Z',
        metadata: {
          changedFileCount: 3,
          restoredCount: 1,
          conflictCount: 1,
          failedCount: 0,
          noopCount: 1,
          contentText: 'after secret should stay out of events',
        },
      },
      fileResults: [{
        restoreFileResultId: 'workspace-restore-file-result-1',
        restoreResultId: 'workspace-restore-result-1',
        changedFileId: 'workspace-changed-file-1',
        projectPath: 'src/app.ts',
        status: 'restored',
        restoredAt: '2026-06-05T10:00:01.000Z',
      }],
    };
    const workspaceRestore = {
      restoreChangeSet: vi.fn(async () => restoreData),
    };
    const publishWorkspaceChangeFooter = vi.fn();
    const service = createRecoveryService({
      repository: createRepository(),
      clock: () => new Date('2026-06-05T10:00:02.000Z'),
      ids: createIds(),
      appendRuntimeEvent,
      nextRuntimeSequence: () => 11,
      workspaceRestore,
      publishWorkspaceChangeFooter,
    });

    const result = await service.restoreWorkspaceChangeSet({
      changeSetId: 'workspace-change-set-1',
      requestedBy: 'user',
      metadata: {
        source: 'recoverable-run-list',
      },
    });

    expect(result).toBe(restoreData);
    expect(workspaceRestore.restoreChangeSet).toHaveBeenCalledWith({
      changeSetId: 'workspace-change-set-1',
      requestedBy: 'user',
      metadata: {
        source: 'recoverable-run-list',
      },
    });
    expect(appendRuntimeEvent).toHaveBeenCalledTimes(2);
    expect(appendRuntimeEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      eventId: 'event_workspace_restore_requested',
      eventType: 'workspace.restore.requested',
      runId: 'run_123',
      sessionId: 'session_123',
      sequence: 11,
      createdAt: '2026-06-05T10:00:02.000Z',
      source: 'main',
      payload: {
        restoreRequestId: 'workspace-restore-request-1',
        changeSetId: 'workspace-change-set-1',
        requestedBy: 'user',
      },
    }));
    expect(appendRuntimeEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      eventId: 'event_workspace_restore_completed',
      eventType: 'workspace.restore.completed',
      runId: 'run_123',
      sessionId: 'session_123',
      sequence: 12,
      createdAt: '2026-06-05T10:00:02.000Z',
      source: 'main',
      payload: {
        restoreRequestId: 'workspace-restore-request-1',
        restoreResultId: 'workspace-restore-result-1',
        changeSetId: 'workspace-change-set-1',
        status: 'partial',
        changedFileCount: 3,
        restoredCount: 1,
        conflictCount: 1,
        failedCount: 0,
        noopCount: 1,
      },
    }));
    expect(publishWorkspaceChangeFooter).toHaveBeenCalledWith('run_123', '2026-06-05T10:00:02.000Z');
    const appendedEvents = JSON.stringify(appendRuntimeEvent.mock.calls.map(([event]) => event));
    expect(appendedEvents).not.toContain('before secret');
    expect(appendedEvents).not.toContain('after secret');
    expect(appendedEvents).not.toContain('contentText');
    expect(appendedEvents).not.toContain('projectPath');
    expect(appendedEvents).not.toContain('src/app.ts');
  });
});


