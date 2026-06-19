// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  openSqliteDatabase,
  runDatabaseMigrations,
  SqliteWorkspaceRepository,
} from '../../../src/database';
import type {
  WorkspaceChangedFile,
  WorkspaceChangeSet,
  WorkspaceCheckpoint,
  WorkspaceRestoreRequest,
  WorkspaceRestoreResult,
} from '../../../src/workspace';

describe('SqliteWorkspaceRepository', () => {
  it('persists workspace change sets, checkpoints, restore requests, and restore results', async () => {
    const database = openSqliteDatabase(':memory:');
    runDatabaseMigrations(database, { now: () => '2026-06-20T00:00:00.000Z' });
    const repository = new SqliteWorkspaceRepository(database);
    const changedFile: WorkspaceChangedFile = {
      id: 'changed-file-1',
      changeSetId: 'change-set-1',
      path: 'src/a.ts' as never,
      operation: 'write',
      before: { path: 'src/a.ts' as never, exists: false, capturedAt: '2026-06-20T00:00:00.000Z' },
      after: { path: 'src/a.ts' as never, exists: true, content: 'next', capturedAt: '2026-06-20T00:00:01.000Z' },
      restoreState: 'not_restored',
      createdAt: '2026-06-20T00:00:01.000Z',
    };
    const changeSet: WorkspaceChangeSet = {
      id: 'change-set-1',
      workspaceId: 'workspace-local',
      sessionId: 'session-1',
      runId: 'run-1',
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
      status: 'finalized',
      changes: [changedFile],
      createdAt: '2026-06-20T00:00:00.000Z',
      updatedAt: '2026-06-20T00:00:01.000Z',
      finalizedAt: '2026-06-20T00:00:01.000Z',
    };
    const checkpoint: WorkspaceCheckpoint = {
      id: 'checkpoint-1',
      workspaceId: 'workspace-local',
      runId: 'run-1',
      changeSetId: 'change-set-1',
      label: 'Before write_file',
      status: 'created',
      snapshots: [changedFile.before],
      createdAt: '2026-06-20T00:00:00.000Z',
      updatedAt: '2026-06-20T00:00:00.000Z',
    };
    const request: WorkspaceRestoreRequest = {
      id: 'restore-request-1',
      workspaceId: 'workspace-local',
      checkpointId: 'checkpoint-1',
      changeSetId: 'change-set-1',
      requestedBy: 'user',
      status: 'pending',
      createdAt: '2026-06-20T00:00:02.000Z',
    };
    const result: WorkspaceRestoreResult = {
      id: 'restore-result-1',
      requestId: request.id,
      checkpointId: checkpoint.id,
      workspaceId: 'workspace-local',
      status: 'completed',
      restoredCount: 1,
      failedCount: 0,
      fileResults: [],
      restoredFiles: [changedFile.before],
      createdAt: request.createdAt,
      completedAt: '2026-06-20T00:00:03.000Z',
    };

    await repository.saveWorkspace({
      id: 'workspace-local',
      projectRoot: 'C:/repo',
      status: 'active',
      createdAt: '2026-06-20T00:00:00.000Z',
      updatedAt: '2026-06-20T00:00:00.000Z',
    });
    await repository.saveChangeSet(changeSet);
    await repository.saveCheckpoint(checkpoint);
    await repository.saveRestoreRequest(request);
    await repository.saveRestoreResult(result);

    await expect(repository.getChangeSet('change-set-1')).resolves.toEqual(expect.objectContaining({
      id: 'change-set-1',
      changes: [expect.objectContaining({ id: 'changed-file-1', path: 'src/a.ts' })],
    }));
    await expect(repository.listChangeSets({ runId: 'run-1' })).resolves.toHaveLength(1);
    await expect(repository.getCheckpoint('checkpoint-1')).resolves.toEqual(expect.objectContaining({ changeSetId: 'change-set-1' }));
    await expect(repository.getRestoreRequest('restore-request-1')).resolves.toEqual(expect.objectContaining({ status: 'pending' }));
    await expect(repository.getRestoreResult('restore-result-1')).resolves.toEqual(expect.objectContaining({ status: 'completed' }));
    database.close();
  });
});
