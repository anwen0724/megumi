// @vitest-environment node
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { WorkspaceChangeRepository } from '@megumi/db/repos/workspace-change.repo';
import { migrateDatabase } from '@megumi/db/schema/migrations';
import type {
  WorkspaceChangedFile,
  WorkspaceChangeSet,
  WorkspaceCheckpoint,
  WorkspaceRestoreFileResult,
  WorkspaceRestoreRequest,
  WorkspaceRestoreResult,
  WorkspaceSnapshotContent,
} from '@megumi/shared/workspace-change-contracts';

let db: Database.Database | null = null;

function createRepo(): WorkspaceChangeRepository {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateDatabase(db);
  seedLifecycle(db);
  return new WorkspaceChangeRepository(db);
}

afterEach(() => {
  db?.close();
  db = null;
});

describe('WorkspaceChangeRepository', () => {
  it('saves and reads UTF-8 snapshot content', () => {
    const repo = createRepo();
    const snapshot = snapshotContent({
      contentRefId: 'snapshot-unicode',
      contentText: 'const greeting = "你好, Megumi";\n',
      byteLength: 31,
      metadata: { source: 'before_snapshot' },
    });

    expect(repo.saveSnapshotContent(snapshot)).toEqual(snapshot);
    expect(repo.getSnapshotContent('snapshot-unicode')).toEqual(snapshot);
  });

  it('saves an open change set, checkpoint, changed file, then finalizes with computed count', () => {
    const repo = createRepo();
    seedSnapshots(repo);
    const changeSet = workspaceChangeSet();
    const checkpoint = workspaceCheckpoint();
    const changedFile = workspaceChangedFile();

    repo.saveChangeSet(changeSet);
    repo.saveWorkspaceCheckpoint(checkpoint);
    repo.saveChangedFile(changedFile);

    const finalized = repo.finalizeChangeSet('change-set-1', '2026-06-05T10:05:00.000Z');

    expect(repo.getChangeSet('change-set-1')).toEqual({
      ...changeSet,
      status: 'finalized',
      changedFileCount: 1,
      finalizedAt: '2026-06-05T10:05:00.000Z',
    });
    expect(finalized?.changedFileCount).toBe(1);
    expect(repo.getWorkspaceCheckpoint('workspace-checkpoint-1')).toEqual(checkpoint);
    expect(repo.getChangedFile('changed-file-1')).toEqual(changedFile);
  });

  it('keeps finalization immutable and rejects new checkpoints after finalization', () => {
    const repo = createRepo();
    seedSnapshots(repo);
    const checkpoint = workspaceCheckpoint();

    repo.saveChangeSet(workspaceChangeSet());
    repo.saveWorkspaceCheckpoint(checkpoint);
    repo.saveChangedFile(workspaceChangedFile());

    const finalized = repo.finalizeChangeSet('change-set-1', '2026-06-05T10:05:00.000Z');

    expect(repo.finalizeChangeSet('change-set-1', '2026-06-05T10:05:00.000Z')).toEqual(finalized);
    expect(() => repo.finalizeChangeSet('change-set-1', '2026-06-05T10:05:01.000Z'))
      .toThrow('Workspace change set change-set-1 is already finalized and cannot be finalized again with different state');
    expect(repo.saveWorkspaceCheckpoint(checkpoint)).toEqual(checkpoint);
    expect(() => repo.saveWorkspaceCheckpoint(workspaceCheckpoint({
      workspaceCheckpointId: 'workspace-checkpoint-after-finalize',
      createdAt: '2026-06-05T10:02:01.000Z',
    }))).toThrow('Cannot save workspace checkpoint workspace-checkpoint-after-finalize into finalized change set change-set-1');
    expect(repo.getChangeSet('change-set-1')).toEqual(finalized);
    expect(repo.listCheckpointsByChangeSet('change-set-1').map((item) => item.workspaceCheckpointId)).toEqual([
      'workspace-checkpoint-1',
    ]);
  });

  it('rejects new changed files after finalizing a change set without changing computed count', () => {
    const repo = createRepo();
    seedSnapshots(repo);
    const changedFile = workspaceChangedFile();

    repo.saveChangeSet(workspaceChangeSet());
    repo.saveWorkspaceCheckpoint(workspaceCheckpoint());
    repo.saveChangedFile(changedFile);
    repo.finalizeChangeSet('change-set-1', '2026-06-05T10:05:00.000Z');

    expect(repo.saveChangedFile(changedFile)).toEqual(changedFile);
    expect(() => repo.saveChangedFile(workspaceChangedFile({
      changedFileId: 'changed-file-after-finalize',
      createdAt: '2026-06-05T10:04:00.000Z',
      updatedAt: '2026-06-05T10:04:00.000Z',
    }))).toThrow('Cannot save changed file changed-file-after-finalize into finalized change set change-set-1');
    expect(repo.getChangeSet('change-set-1')?.changedFileCount).toBe(1);
    expect(repo.listChangedFilesByChangeSet('change-set-1').map((file) => file.changedFileId)).toEqual([
      'changed-file-1',
    ]);
  });

  it('rejects conflicting duplicate snapshot content while allowing identical saves', () => {
    const repo = createRepo();
    const snapshot = snapshotContent({ contentRefId: 'snapshot-immutable' });

    expect(repo.saveSnapshotContent(snapshot)).toEqual(snapshot);
    expect(repo.saveSnapshotContent(snapshot)).toEqual(snapshot);

    expect(() => repo.saveSnapshotContent({
      ...snapshot,
      sha256: hash('c'),
      contentText: 'changed',
    })).toThrow('Snapshot content snapshot-immutable already exists with different durable fields');
    expect(repo.getSnapshotContent('snapshot-immutable')).toEqual(snapshot);
  });

  it('rejects unsafe change set rewrites', () => {
    const repo = createRepo();
    const changeSet = workspaceChangeSet();

    expect(repo.saveChangeSet(changeSet)).toEqual(changeSet);
    expect(repo.saveChangeSet(changeSet)).toEqual(changeSet);
    expect(() => repo.saveChangeSet(workspaceChangeSet({ sessionId: 'session-2', runId: 'run-2' })))
      .toThrow('Workspace change set change-set-1 already exists with different durable fields');
    expect(() => repo.saveChangeSet(workspaceChangeSet({ responseMessageId: 'message-2' })))
      .toThrow('Workspace change set change-set-1 already exists with different durable fields');
    expect(() => repo.saveChangeSet(workspaceChangeSet({ createdAt: '2026-06-05T10:01:01.000Z' })))
      .toThrow('Workspace change set change-set-1 already exists with different durable fields');
    expect(() => repo.saveChangeSet(workspaceChangeSet({ changedFileCount: 1 })))
      .toThrow('Workspace change set change-set-1 already exists with different durable fields');
    expect(() => repo.saveChangeSet(workspaceChangeSet({
      status: 'finalized',
      finalizedAt: '2026-06-05T10:05:00.000Z',
    }))).toThrow('Workspace change set change-set-1 already exists with different durable fields');

    repo.finalizeChangeSet('change-set-1', '2026-06-05T10:05:00.000Z');
    expect(() => repo.saveChangeSet(workspaceChangeSet()))
      .toThrow('Workspace change set change-set-1 already exists with different durable fields');
  });

  it('summarizes changed file restore states', () => {
    const repo = createRepo();
    seedSnapshots(repo);
    repo.saveChangeSet(workspaceChangeSet());
    repo.saveWorkspaceCheckpoint(workspaceCheckpoint());
    repo.saveChangedFile(workspaceChangedFile({
      changedFileId: 'changed-file-restorable',
      restoreState: 'restorable',
      createdAt: '2026-06-05T10:04:00.000Z',
      updatedAt: '2026-06-05T10:04:00.000Z',
    }));
    repo.saveChangedFile(workspaceChangedFile({
      changedFileId: 'changed-file-restored',
      restoreState: 'restored',
      createdAt: '2026-06-05T10:04:01.000Z',
      updatedAt: '2026-06-05T10:04:01.000Z',
    }));
    repo.saveChangedFile(workspaceChangedFile({
      changedFileId: 'changed-file-conflict',
      restoreState: 'conflict',
      createdAt: '2026-06-05T10:04:02.000Z',
      updatedAt: '2026-06-05T10:04:02.000Z',
    }));
    repo.saveChangedFile(workspaceChangedFile({
      changedFileId: 'changed-file-failed',
      restoreState: 'restore_failed',
      createdAt: '2026-06-05T10:04:03.000Z',
      updatedAt: '2026-06-05T10:04:03.000Z',
    }));
    repo.saveChangedFile(workspaceChangedFile({
      changedFileId: 'changed-file-not-restorable',
      restoreState: 'not_restorable',
      createdAt: '2026-06-05T10:04:04.000Z',
      updatedAt: '2026-06-05T10:04:04.000Z',
    }));

    expect(repo.getChangeSummary('change-set-1')).toEqual({
      changeSetId: 'change-set-1',
      sessionId: 'session-1',
      runId: 'run-1',
      changedFileCount: 5,
      restorableCount: 1,
      restoredCount: 1,
      conflictCount: 1,
      failedCount: 1,
      hasRestorableChanges: true,
      updatedAt: '2026-06-05T10:04:04.000Z',
    });
  });

  it('lists change sets and changed files in stable order', () => {
    const repo = createRepo();
    seedSnapshots(repo);
    for (const changeSet of [
      workspaceChangeSet({ changeSetId: 'change-set-b', createdAt: '2026-06-05T10:01:00.000Z' }),
      workspaceChangeSet({ changeSetId: 'change-set-a', createdAt: '2026-06-05T10:01:00.000Z' }),
      workspaceChangeSet({ changeSetId: 'change-set-c', createdAt: '2026-06-05T10:02:00.000Z' }),
    ]) {
      repo.saveChangeSet(changeSet);
    }
    repo.saveWorkspaceCheckpoint(workspaceCheckpoint({ changeSetId: 'change-set-a' }));
    for (const changedFile of [
      workspaceChangedFile({
        changedFileId: 'changed-file-b',
        changeSetId: 'change-set-a',
        createdAt: '2026-06-05T10:03:00.000Z',
        updatedAt: '2026-06-05T10:03:00.000Z',
      }),
      workspaceChangedFile({
        changedFileId: 'changed-file-a',
        changeSetId: 'change-set-a',
        createdAt: '2026-06-05T10:03:00.000Z',
        updatedAt: '2026-06-05T10:03:00.000Z',
      }),
      workspaceChangedFile({
        changedFileId: 'changed-file-c',
        changeSetId: 'change-set-a',
        createdAt: '2026-06-05T10:04:00.000Z',
        updatedAt: '2026-06-05T10:04:00.000Z',
      }),
    ]) {
      repo.saveChangedFile(changedFile);
    }

    expect(repo.listChangeSetsByRun('run-1').map((item) => item.changeSetId)).toEqual([
      'change-set-a',
      'change-set-b',
      'change-set-c',
    ]);
    expect(repo.listChangedFilesByChangeSet('change-set-a').map((item) => item.changedFileId)).toEqual([
      'changed-file-a',
      'changed-file-b',
      'changed-file-c',
    ]);
    expect(repo.listChangedFilesByRun('run-1').map((item) => item.changedFileId)).toEqual([
      'changed-file-a',
      'changed-file-b',
      'changed-file-c',
    ]);
  });

  it('persists restore request, result, and file results', () => {
    const repo = createRepo();
    seedChange(repo);
    const request = restoreRequest();
    const result = restoreResult();
    const restoredFile = restoreFileResult();
    const conflictFile = restoreFileResult({
      restoreFileResultId: 'restore-file-result-conflict',
      status: 'conflict',
      conflictReason: 'current_hash_mismatch',
      restoredAt: '2026-06-05T10:06:03.000Z',
    });

    repo.saveRestoreRequest(request);
    repo.saveRestoreResult(result);
    repo.saveRestoreFileResult(restoredFile);
    repo.saveRestoreFileResult(conflictFile);

    expect(repo.getRestoreRequest('restore-request-1')).toEqual(request);
    expect(repo.getRestoreResult('restore-result-1')).toEqual(result);
    expect(repo.listRestoreResultsByChangeSet('change-set-1')).toEqual([result]);
    expect(repo.listRestoreFileResultsByResult('restore-result-1')).toEqual([
      restoredFile,
      conflictFile,
    ]);
  });

  it('orders restore results and file results by restored timestamp, then primary key', () => {
    const repo = createRepo();
    seedChange(repo);
    repo.saveRestoreRequest(restoreRequest());
    for (const result of [
      restoreResult({
        restoreResultId: 'restore-result-b',
        restoredAt: '2026-06-05T10:07:00.000Z',
      }),
      restoreResult({
        restoreResultId: 'restore-result-a',
        restoredAt: '2026-06-05T10:07:00.000Z',
      }),
      restoreResult({
        restoreResultId: 'restore-result-z',
        restoredAt: '2026-06-05T10:06:00.000Z',
      }),
    ]) {
      repo.saveRestoreResult(result);
    }

    repo.saveRestoreFileResult(restoreFileResult({
      restoreFileResultId: 'restore-file-result-b',
      restoreResultId: 'restore-result-a',
      restoredAt: '2026-06-05T10:09:00.000Z',
    }));
    repo.saveRestoreFileResult(restoreFileResult({
      restoreFileResultId: 'restore-file-result-a',
      restoreResultId: 'restore-result-a',
      restoredAt: '2026-06-05T10:09:00.000Z',
    }));
    repo.saveRestoreFileResult(restoreFileResult({
      restoreFileResultId: 'restore-file-result-z',
      restoreResultId: 'restore-result-a',
      restoredAt: '2026-06-05T10:08:00.000Z',
    }));

    expect(repo.listRestoreResultsByChangeSet('change-set-1').map((item) => item.restoreResultId)).toEqual([
      'restore-result-z',
      'restore-result-a',
      'restore-result-b',
    ]);
    expect(repo.listRestoreFileResultsByResult('restore-result-a').map((item) => item.restoreFileResultId)).toEqual([
      'restore-file-result-z',
      'restore-file-result-a',
      'restore-file-result-b',
    ]);
  });

  it('rejects mismatched session and run across change set, checkpoint, and changed file', () => {
    const repo = createRepo();
    seedSnapshots(repo);
    repo.saveChangeSet(workspaceChangeSet());

    expect(() => repo.saveWorkspaceCheckpoint(workspaceCheckpoint({
      workspaceCheckpointId: 'workspace-checkpoint-session-mismatch',
      sessionId: 'session-2',
    }))).toThrow('Workspace checkpoint sessionId session-2 does not match change set sessionId session-1');
    expect(() => repo.saveWorkspaceCheckpoint(workspaceCheckpoint({
      workspaceCheckpointId: 'workspace-checkpoint-run-mismatch',
      runId: 'run-2',
    }))).toThrow('Workspace checkpoint runId run-2 does not match change set runId run-1');

    repo.saveWorkspaceCheckpoint(workspaceCheckpoint());

    expect(() => repo.saveChangedFile(workspaceChangedFile({
      changedFileId: 'changed-file-change-set-session-mismatch',
      sessionId: 'session-2',
    }))).toThrow('Changed file sessionId session-2 does not match change set sessionId session-1');
    expect(() => repo.saveChangedFile(workspaceChangedFile({
      changedFileId: 'changed-file-checkpoint-run-mismatch',
      runId: 'run-2',
    }))).toThrow('Changed file runId run-2 does not match change set runId run-1');

    repo.saveChangeSet(workspaceChangeSet({
      changeSetId: 'change-set-2',
      sessionId: 'session-2',
      runId: 'run-2',
      stepId: 'step-2',
      sourceEntryId: 'source-2',
      responseMessageId: 'message-2',
    }));
    repo.saveWorkspaceCheckpoint(workspaceCheckpoint({
      workspaceCheckpointId: 'workspace-checkpoint-2',
      changeSetId: 'change-set-2',
      sessionId: 'session-2',
      runId: 'run-2',
      stepId: 'step-2',
      toolCallId: 'tool-call-2',
      toolExecutionId: 'tool-execution-2',
      sourceEntryId: 'source-2',
      responseMessageId: 'message-2',
      beforeContentRefId: 'snapshot-before-2',
      beforeHash: hash('c'),
      beforeByteLength: 7,
    }));
    expect(() => repo.saveChangedFile(workspaceChangedFile({
      changedFileId: 'changed-file-checkpoint-session-mismatch',
      workspaceCheckpointId: 'workspace-checkpoint-2',
    }))).toThrow('Changed file workspaceCheckpointId workspace-checkpoint-2 belongs to sessionId session-2, not session-1');
  });

  it('rejects lifecycle ref ownership mismatches', () => {
    const repo = createRepo();
    seedSnapshots(repo);

    expect(() => repo.saveChangeSet(workspaceChangeSet({ runId: 'run-2' })))
      .toThrow('Workspace change set runId run-2 does not belong to sessionId session-1');
    expect(() => repo.saveChangeSet(workspaceChangeSet({
      changeSetId: 'change-set-step-mismatch',
      stepId: 'step-2',
    }))).toThrow('Workspace change set stepId step-2 does not belong to runId run-1');
    expect(() => repo.saveChangeSet(workspaceChangeSet({
      changeSetId: 'change-set-source-mismatch',
      sourceEntryId: 'source-2',
    }))).toThrow('Workspace change set sourceEntryId source-2 does not belong to sessionId session-1');
    expect(() => repo.saveChangeSet(workspaceChangeSet({
      changeSetId: 'change-set-message-mismatch',
      responseMessageId: 'message-2',
    }))).toThrow('Workspace change set responseMessageId message-2 does not belong to sessionId session-1');

    repo.saveChangeSet(workspaceChangeSet());
    expect(() => repo.saveWorkspaceCheckpoint(workspaceCheckpoint({
      workspaceCheckpointId: 'checkpoint-run-session-mismatch',
      changeSetId: undefined,
      runId: 'run-2',
    }))).toThrow('Workspace checkpoint runId run-2 does not belong to sessionId session-1');
    expect(() => repo.saveWorkspaceCheckpoint(workspaceCheckpoint({
      workspaceCheckpointId: 'checkpoint-step-mismatch',
      stepId: 'step-2',
    }))).toThrow('Workspace checkpoint stepId step-2 does not belong to runId run-1');
    expect(() => repo.saveWorkspaceCheckpoint(workspaceCheckpoint({
      workspaceCheckpointId: 'checkpoint-source-mismatch',
      sourceEntryId: 'source-2',
    }))).toThrow('Workspace checkpoint sourceEntryId source-2 does not belong to sessionId session-1');
    expect(() => repo.saveWorkspaceCheckpoint(workspaceCheckpoint({
      workspaceCheckpointId: 'checkpoint-message-mismatch',
      responseMessageId: 'message-2',
    }))).toThrow('Workspace checkpoint responseMessageId message-2 does not belong to sessionId session-1');
    expect(() => repo.saveWorkspaceCheckpoint(workspaceCheckpoint({
      workspaceCheckpointId: 'checkpoint-tool-call-mismatch',
      toolCallId: 'tool-call-2',
    }))).toThrow('Workspace checkpoint toolCallId tool-call-2 does not belong to runId run-1');
    expect(() => repo.saveWorkspaceCheckpoint(workspaceCheckpoint({
      workspaceCheckpointId: 'checkpoint-tool-execution-mismatch',
      toolExecutionId: 'tool-execution-2',
    }))).toThrow('Workspace checkpoint toolExecutionId tool-execution-2 does not belong to runId run-1');

    repo.saveWorkspaceCheckpoint(workspaceCheckpoint());
    expect(() => repo.saveChangedFile(workspaceChangedFile({
      changedFileId: 'changed-file-step-mismatch',
      stepId: 'step-2',
    }))).toThrow('Changed file stepId step-2 does not belong to runId run-1');
    expect(() => repo.saveChangedFile(workspaceChangedFile({
      changedFileId: 'changed-file-source-mismatch',
      sourceEntryId: 'source-2',
    }))).toThrow('Changed file sourceEntryId source-2 does not belong to sessionId session-1');
    expect(() => repo.saveChangedFile(workspaceChangedFile({
      changedFileId: 'changed-file-message-mismatch',
      responseMessageId: 'message-2',
    }))).toThrow('Changed file responseMessageId message-2 does not belong to sessionId session-1');
    expect(() => repo.saveChangedFile(workspaceChangedFile({
      changedFileId: 'changed-file-tool-call-mismatch',
      toolCallId: 'tool-call-2',
    }))).toThrow('Changed file toolCallId tool-call-2 does not belong to runId run-1');
    expect(() => repo.saveChangedFile(workspaceChangedFile({
      changedFileId: 'changed-file-tool-execution-mismatch',
      toolExecutionId: 'tool-execution-2',
    }))).toThrow('Changed file toolExecutionId tool-execution-2 does not belong to runId run-1');
  });

  it('rejects changed file with a different project path from its checkpoint', () => {
    const repo = createRepo();
    seedSnapshots(repo);
    repo.saveChangeSet(workspaceChangeSet());
    repo.saveWorkspaceCheckpoint(workspaceCheckpoint());

    expect(() => repo.saveChangedFile(workspaceChangedFile({
      changedFileId: 'changed-file-path-mismatch',
      projectPath: 'src/other.ts',
    }))).toThrow('Changed file projectPath src/other.ts does not match checkpoint projectPath src/app.ts');
  });

  it('rejects snapshot content refs from a different run or project path', () => {
    const repo = createRepo();
    seedSnapshots(repo);
    repo.saveSnapshotContent(snapshotContent({
      contentRefId: 'snapshot-run-2',
      sessionId: 'session-2',
      runId: 'run-2',
    }));
    repo.saveSnapshotContent(snapshotContent({
      contentRefId: 'snapshot-other-path',
      projectPath: 'src/other.ts',
    }));
    repo.saveChangeSet(workspaceChangeSet());

    expect(() => repo.saveWorkspaceCheckpoint(workspaceCheckpoint({
      workspaceCheckpointId: 'checkpoint-cross-run-snapshot',
      beforeContentRefId: 'snapshot-run-2',
    }))).toThrow('Workspace checkpoint beforeContentRefId snapshot-run-2 belongs to sessionId session-2/runId run-2/projectPath src/app.ts, not sessionId session-1/runId run-1/projectPath src/app.ts');
    expect(() => repo.saveWorkspaceCheckpoint(workspaceCheckpoint({
      workspaceCheckpointId: 'checkpoint-cross-path-snapshot',
      beforeContentRefId: 'snapshot-other-path',
    }))).toThrow('Workspace checkpoint beforeContentRefId snapshot-other-path belongs to sessionId session-1/runId run-1/projectPath src/other.ts, not sessionId session-1/runId run-1/projectPath src/app.ts');

    repo.saveWorkspaceCheckpoint(workspaceCheckpoint());
    expect(() => repo.saveChangedFile(workspaceChangedFile({
      changedFileId: 'changed-file-before-cross-run-snapshot',
      beforeContentRefId: 'snapshot-run-2',
    }))).toThrow('Changed file beforeContentRefId snapshot-run-2 belongs to sessionId session-2/runId run-2/projectPath src/app.ts, not sessionId session-1/runId run-1/projectPath src/app.ts');
    expect(() => repo.saveChangedFile(workspaceChangedFile({
      changedFileId: 'changed-file-after-cross-path-snapshot',
      afterContentRefId: 'snapshot-other-path',
    }))).toThrow('Changed file afterContentRefId snapshot-other-path belongs to sessionId session-1/runId run-1/projectPath src/other.ts, not sessionId session-1/runId run-1/projectPath src/app.ts');
  });

  it('rejects snapshot content refs with mismatched hash or byte length', () => {
    const repo = createRepo();
    seedSnapshots(repo);
    repo.saveChangeSet(workspaceChangeSet());

    expect(() => repo.saveWorkspaceCheckpoint(workspaceCheckpoint({
      workspaceCheckpointId: 'checkpoint-before-hash-mismatch',
      beforeHash: hash('c'),
    }))).toThrow('Workspace checkpoint beforeContentRefId snapshot-before sha256 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa does not match beforeHash cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc');
    expect(() => repo.saveWorkspaceCheckpoint(workspaceCheckpoint({
      workspaceCheckpointId: 'checkpoint-before-length-mismatch',
      beforeByteLength: 7,
    }))).toThrow('Workspace checkpoint beforeContentRefId snapshot-before byteLength 6 does not match beforeByteLength 7');

    repo.saveWorkspaceCheckpoint(workspaceCheckpoint());
    expect(() => repo.saveChangedFile(workspaceChangedFile({
      changedFileId: 'changed-file-before-hash-mismatch',
      beforeHash: hash('c'),
    }))).toThrow('Changed file beforeContentRefId snapshot-before sha256 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa does not match beforeHash cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc');
    expect(() => repo.saveChangedFile(workspaceChangedFile({
      changedFileId: 'changed-file-before-length-mismatch',
      beforeByteLength: 7,
    }))).toThrow('Changed file beforeContentRefId snapshot-before byteLength 6 does not match beforeByteLength 7');
    expect(() => repo.saveChangedFile(workspaceChangedFile({
      changedFileId: 'changed-file-after-hash-mismatch',
      afterHash: hash('c'),
    }))).toThrow('Changed file afterContentRefId snapshot-after sha256 bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb does not match afterHash cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc');
    expect(() => repo.saveChangedFile(workspaceChangedFile({
      changedFileId: 'changed-file-after-length-mismatch',
      afterByteLength: 6,
    }))).toThrow('Changed file afterContentRefId snapshot-after byteLength 5 does not match afterByteLength 6');
  });

  it('rejects conflicting duplicate durable audit rows while allowing identical saves', () => {
    const repo = createRepo();
    seedChange(repo);

    const checkpoint = workspaceCheckpoint({ workspaceCheckpointId: 'workspace-checkpoint-immutable' });
    repo.saveWorkspaceCheckpoint(checkpoint);
    expect(repo.saveWorkspaceCheckpoint(checkpoint)).toEqual(checkpoint);
    expect(() => repo.saveWorkspaceCheckpoint({
      ...checkpoint,
      createdAt: '2026-06-05T10:02:01.000Z',
    })).toThrow('Workspace checkpoint workspace-checkpoint-immutable already exists with different durable fields');

    const changedFile = workspaceChangedFile({
      changedFileId: 'changed-file-immutable',
      workspaceCheckpointId: 'workspace-checkpoint-immutable',
    });
    repo.saveChangedFile(changedFile);
    expect(repo.saveChangedFile(changedFile)).toEqual(changedFile);
    expect(() => repo.saveChangedFile({
      ...changedFile,
      updatedAt: '2026-06-05T10:03:01.000Z',
    })).toThrow('Changed file changed-file-immutable already exists with different durable fields');

    const request = restoreRequest({ restoreRequestId: 'restore-request-immutable' });
    repo.saveRestoreRequest(request);
    expect(repo.saveRestoreRequest(request)).toEqual(request);
    expect(() => repo.saveRestoreRequest({
      ...request,
      status: 'running',
    })).toThrow('Restore request restore-request-immutable already exists with different durable fields');

    const result = restoreResult({
      restoreResultId: 'restore-result-immutable',
      restoreRequestId: 'restore-request-immutable',
    });
    repo.saveRestoreResult(result);
    expect(repo.saveRestoreResult(result)).toEqual(result);
    expect(() => repo.saveRestoreResult({
      ...result,
      restoredAt: '2026-06-05T10:06:04.000Z',
    })).toThrow('Restore result restore-result-immutable already exists with different durable fields');

    const fileResult = restoreFileResult({
      restoreFileResultId: 'restore-file-result-immutable',
      restoreResultId: 'restore-result-immutable',
    });
    repo.saveRestoreFileResult(fileResult);
    expect(repo.saveRestoreFileResult(fileResult)).toEqual(fileResult);
    expect(() => repo.saveRestoreFileResult({
      ...fileResult,
      status: 'conflict',
      conflictReason: 'current_hash_mismatch',
    })).toThrow('Restore file result restore-file-result-immutable already exists with different durable fields');
  });

  it('rejects restore result and file result ownership mismatches', () => {
    const repo = createRepo();
    seedChange(repo);
    repo.saveRestoreRequest(restoreRequest());

    expect(() => repo.saveRestoreRequest(restoreRequest({
      restoreRequestId: 'restore-request-run-mismatch',
      runId: 'run-2',
    }))).toThrow('Restore request runId run-2 does not match change set runId run-1');
    expect(() => repo.saveRestoreResult(restoreResult({
      restoreResultId: 'restore-result-request-run-mismatch',
      runId: 'run-2',
    }))).toThrow('Restore result runId run-2 does not match request runId run-1');

    repo.saveRestoreResult(restoreResult());
    repo.saveChangeSet(workspaceChangeSet({
      changeSetId: 'change-set-2',
      sessionId: 'session-2',
      runId: 'run-2',
      stepId: 'step-2',
      sourceEntryId: 'source-2',
      responseMessageId: 'message-2',
    }));
    repo.saveWorkspaceCheckpoint(workspaceCheckpoint({
      workspaceCheckpointId: 'workspace-checkpoint-2',
      changeSetId: 'change-set-2',
      sessionId: 'session-2',
      runId: 'run-2',
      stepId: 'step-2',
      toolCallId: 'tool-call-2',
      toolExecutionId: 'tool-execution-2',
      sourceEntryId: 'source-2',
      responseMessageId: 'message-2',
      beforeContentRefId: 'snapshot-before-2',
      beforeHash: hash('c'),
      beforeByteLength: 7,
    }));
    repo.saveChangedFile(workspaceChangedFile({
      changedFileId: 'changed-file-2',
      changeSetId: 'change-set-2',
      workspaceCheckpointId: 'workspace-checkpoint-2',
      sessionId: 'session-2',
      runId: 'run-2',
      stepId: 'step-2',
      toolCallId: 'tool-call-2',
      toolExecutionId: 'tool-execution-2',
      sourceEntryId: 'source-2',
      responseMessageId: 'message-2',
      beforeContentRefId: 'snapshot-before-2',
      afterContentRefId: 'snapshot-after-2',
      beforeHash: hash('c'),
      beforeByteLength: 7,
      afterHash: hash('d'),
      afterByteLength: 6,
    }));

    expect(() => repo.saveRestoreFileResult(restoreFileResult({
      restoreFileResultId: 'restore-file-result-mismatch',
      changedFileId: 'changed-file-2',
    }))).toThrow('Restore file result changedFileId changed-file-2 belongs to changeSetId change-set-2, not change-set-1');
    expect(() => repo.saveRestoreFileResult(restoreFileResult({
      restoreFileResultId: 'restore-file-result-path-mismatch',
      projectPath: 'src/other.ts',
    }))).toThrow('Restore file result projectPath src/other.ts does not match changed file projectPath src/app.ts');
  });

  it('cascades reads to empty when deleting a session', () => {
    const repo = createRepo();
    seedChange(repo);
    repo.saveRestoreRequest(restoreRequest());
    repo.saveRestoreResult(restoreResult());
    repo.saveRestoreFileResult(restoreFileResult());

    currentDb().prepare("DELETE FROM sessions WHERE session_id = 'session-1'").run();

    expect(repo.getSnapshotContent('snapshot-before')).toBeUndefined();
    expect(repo.getChangeSet('change-set-1')).toBeUndefined();
    expect(repo.listChangeSetsByRun('run-1')).toEqual([]);
    expect(repo.getWorkspaceCheckpoint('workspace-checkpoint-1')).toBeUndefined();
    expect(repo.listCheckpointsByChangeSet('change-set-1')).toEqual([]);
    expect(repo.getChangedFile('changed-file-1')).toBeUndefined();
    expect(repo.listChangedFilesByChangeSet('change-set-1')).toEqual([]);
    expect(repo.listChangedFilesByRun('run-1')).toEqual([]);
    expect(repo.getChangeSummary('change-set-1')).toBeUndefined();
    expect(repo.getRestoreRequest('restore-request-1')).toBeUndefined();
    expect(repo.getRestoreResult('restore-result-1')).toBeUndefined();
    expect(repo.listRestoreResultsByChangeSet('change-set-1')).toEqual([]);
    expect(repo.listRestoreFileResultsByResult('restore-result-1')).toEqual([]);
  });

  it('returns raw content only through snapshot content reads', () => {
    const repo = createRepo();
    seedChange(repo);

    expect(repo.getSnapshotContent('snapshot-before')).toHaveProperty('contentText', 'before');
    expect(repo.getWorkspaceCheckpoint('workspace-checkpoint-1')).not.toHaveProperty('contentText');
    expect(repo.getChangedFile('changed-file-1')).not.toHaveProperty('contentText');
    expect(JSON.stringify(repo.getWorkspaceCheckpoint('workspace-checkpoint-1'))).not.toContain('"contentText"');
    expect(JSON.stringify(repo.getChangedFile('changed-file-1'))).not.toContain('"contentText"');
  });
});

function currentDb(): Database.Database {
  if (!db) {
    throw new Error('Test database is not initialized.');
  }
  return db;
}

function seedChange(repo: WorkspaceChangeRepository): void {
  seedSnapshots(repo);
  repo.saveChangeSet(workspaceChangeSet());
  repo.saveWorkspaceCheckpoint(workspaceCheckpoint());
  repo.saveChangedFile(workspaceChangedFile());
}

function seedSnapshots(repo: WorkspaceChangeRepository): void {
  repo.saveSnapshotContent(snapshotContent({
    contentRefId: 'snapshot-before',
    sha256: hash('a'),
    byteLength: 6,
    contentText: 'before',
    createdAt: '2026-06-05T10:00:00.000Z',
  }));
  repo.saveSnapshotContent(snapshotContent({
    contentRefId: 'snapshot-after',
    sha256: hash('b'),
    byteLength: 5,
    contentText: 'after',
    createdAt: '2026-06-05T10:00:01.000Z',
  }));
  repo.saveSnapshotContent(snapshotContent({
    contentRefId: 'snapshot-before-2',
    sessionId: 'session-2',
    runId: 'run-2',
    sha256: hash('c'),
    byteLength: 7,
    contentText: 'before2',
    createdAt: '2026-06-05T10:00:02.000Z',
  }));
  repo.saveSnapshotContent(snapshotContent({
    contentRefId: 'snapshot-after-2',
    sessionId: 'session-2',
    runId: 'run-2',
    sha256: hash('d'),
    byteLength: 6,
    contentText: 'after2',
    createdAt: '2026-06-05T10:00:03.000Z',
  }));
}

function snapshotContent(overrides: Partial<WorkspaceSnapshotContent> = {}): WorkspaceSnapshotContent {
  return {
    contentRefId: 'snapshot-before',
    sessionId: 'session-1',
    runId: 'run-1',
    projectPath: 'src/app.ts',
    storage: 'sqlite_text',
    encoding: 'utf8',
    sha256: hash('a'),
    byteLength: 6,
    contentText: 'before',
    createdAt: '2026-06-05T10:00:00.000Z',
    ...overrides,
  };
}

function workspaceChangeSet(overrides: Partial<WorkspaceChangeSet> = {}): WorkspaceChangeSet {
  return {
    changeSetId: 'change-set-1',
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: 'step-1',
    sourceEntryId: 'source-1',
    responseMessageId: 'message-1',
    status: 'open',
    changedFileCount: 0,
    createdAt: '2026-06-05T10:01:00.000Z',
    metadata: { responseScope: 'assistant_message' },
    ...overrides,
  };
}

function workspaceCheckpoint(overrides: Partial<WorkspaceCheckpoint> = {}): WorkspaceCheckpoint {
  return {
    workspaceCheckpointId: 'workspace-checkpoint-1',
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: 'step-1',
    toolCallId: 'tool-call-1',
    toolExecutionId: 'tool-execution-1',
    sourceEntryId: 'source-1',
    responseMessageId: 'message-1',
    changeSetId: 'change-set-1',
    projectPath: 'src/app.ts',
    beforeExists: true,
    beforeContentRefId: 'snapshot-before',
    beforeHash: hash('a'),
    beforeByteLength: 6,
    createdAt: '2026-06-05T10:02:00.000Z',
    metadata: { toolName: 'write_file' },
    ...overrides,
  };
}

function workspaceChangedFile(overrides: Partial<WorkspaceChangedFile> = {}): WorkspaceChangedFile {
  return {
    changedFileId: 'changed-file-1',
    changeSetId: 'change-set-1',
    workspaceCheckpointId: 'workspace-checkpoint-1',
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: 'step-1',
    toolCallId: 'tool-call-1',
    toolExecutionId: 'tool-execution-1',
    sourceEntryId: 'source-1',
    responseMessageId: 'message-1',
    projectPath: 'src/app.ts',
    changeKind: 'modified',
    restoreState: 'restorable',
    beforeExists: true,
    beforeContentRefId: 'snapshot-before',
    beforeHash: hash('a'),
    beforeByteLength: 6,
    afterExists: true,
    afterContentRefId: 'snapshot-after',
    afterHash: hash('b'),
    afterByteLength: 5,
    createdAt: '2026-06-05T10:03:00.000Z',
    updatedAt: '2026-06-05T10:03:00.000Z',
    metadata: { writeKind: 'overwrite' },
    ...overrides,
  };
}

function restoreRequest(overrides: Partial<WorkspaceRestoreRequest> = {}): WorkspaceRestoreRequest {
  return {
    restoreRequestId: 'restore-request-1',
    changeSetId: 'change-set-1',
    sessionId: 'session-1',
    runId: 'run-1',
    requestedBy: 'user',
    status: 'requested',
    requestedAt: '2026-06-05T10:06:00.000Z',
    metadata: { source: 'test' },
    ...overrides,
  };
}

function restoreResult(overrides: Partial<WorkspaceRestoreResult> = {}): WorkspaceRestoreResult {
  return {
    restoreResultId: 'restore-result-1',
    restoreRequestId: 'restore-request-1',
    changeSetId: 'change-set-1',
    sessionId: 'session-1',
    runId: 'run-1',
    status: 'restored',
    restoredAt: '2026-06-05T10:06:01.000Z',
    metadata: { fileCount: 1 },
    ...overrides,
  };
}

function restoreFileResult(overrides: Partial<WorkspaceRestoreFileResult> = {}): WorkspaceRestoreFileResult {
  return {
    restoreFileResultId: 'restore-file-result-1',
    restoreResultId: 'restore-result-1',
    changedFileId: 'changed-file-1',
    projectPath: 'src/app.ts',
    status: 'restored',
    restoredAt: '2026-06-05T10:06:02.000Z',
    metadata: { restoredBytes: 6 },
    ...overrides,
  };
}

function seedLifecycle(database: Database.Database): void {
  database.exec(`
    INSERT INTO sessions (session_id, title, status, created_at, updated_at)
    VALUES
      ('session-1', 'Workspace change session', 'active', '2026-06-05T09:00:00.000Z', '2026-06-05T09:00:00.000Z'),
      ('session-2', 'Other workspace change session', 'active', '2026-06-05T09:00:00.000Z', '2026-06-05T09:00:00.000Z');

    INSERT INTO runs (run_id, session_id, mode, goal, status, created_at)
    VALUES
      ('run-1', 'session-1', 'chat', 'Change a file', 'running', '2026-06-05T09:01:00.000Z'),
      ('run-2', 'session-2', 'chat', 'Change another file', 'running', '2026-06-05T09:01:00.000Z');

    INSERT INTO run_steps (step_id, run_id, kind, status)
    VALUES
      ('step-1', 'run-1', 'tool', 'running'),
      ('step-2', 'run-2', 'tool', 'running');

    INSERT INTO session_messages (message_id, session_id, run_id, role, content, status, created_at)
    VALUES
      ('message-1', 'session-1', 'run-1', 'assistant', 'Changed src/app.ts', 'completed', '2026-06-05T09:02:00.000Z'),
      ('message-2', 'session-2', 'run-2', 'assistant', 'Changed src/app.ts', 'completed', '2026-06-05T09:02:00.000Z');

    INSERT INTO session_source_entries (
      source_entry_id,
      session_id,
      source_kind,
      source_id,
      source_ref_json,
      created_at
    ) VALUES
      (
        'source-1',
        'session-1',
        'session_message',
        'message-1',
        '{"sourceKind":"session_message","sourceId":"message-1"}',
        '2026-06-05T09:02:00.000Z'
      ),
      (
        'source-2',
        'session-2',
        'session_message',
        'message-2',
        '{"sourceKind":"session_message","sourceId":"message-2"}',
        '2026-06-05T09:02:00.000Z'
      );

    INSERT INTO model_steps (
      model_step_id,
      run_id,
      step_id,
      provider_id,
      model_id,
      status,
      started_at,
      model_step_json
    ) VALUES
      (
        'model-step-1',
        'run-1',
        'step-1',
        'openai-compatible',
        'gpt-5',
        'completed',
        '2026-06-05T09:02:30.000Z',
        '{}'
      ),
      (
        'model-step-2',
        'run-2',
        'step-2',
        'openai-compatible',
        'gpt-5',
        'completed',
        '2026-06-05T09:02:30.000Z',
        '{}'
      );

    INSERT INTO tool_calls (
      tool_call_id,
      run_id,
      model_step_id,
      provider_tool_call_id,
      tool_name,
      input_json,
      input_preview_json,
      status,
      created_at,
      tool_call_json
    ) VALUES
      (
        'tool-call-1',
        'run-1',
        'model-step-1',
        'provider-tool-call-1',
        'write_file',
        '{}',
        '{}',
        'completed',
        '2026-06-05T09:03:00.000Z',
        '{}'
      ),
      (
        'tool-call-2',
        'run-2',
        'model-step-2',
        'provider-tool-call-2',
        'write_file',
        '{}',
        '{}',
        'completed',
        '2026-06-05T09:03:00.000Z',
        '{}'
      );

    INSERT INTO tool_executions (
      tool_execution_id,
      tool_call_id,
      run_id,
      step_id,
      tool_name,
      input_json,
      input_preview_json,
      capabilities_json,
      risk_level,
      side_effect,
      status,
      requested_at,
      tool_execution_json
    ) VALUES
      (
        'tool-execution-1',
        'tool-call-1',
        'run-1',
        'step-1',
        'write_file',
        '{}',
        '{}',
        '["project_write"]',
        'medium',
        'write_file',
        'succeeded',
        '2026-06-05T09:03:01.000Z',
        '{}'
      ),
      (
        'tool-execution-2',
        'tool-call-2',
        'run-2',
        'step-2',
        'write_file',
        '{}',
        '{}',
        '["project_write"]',
        'medium',
        'write_file',
        'succeeded',
        '2026-06-05T09:03:01.000Z',
        '{}'
      );
  `);
}

function hash(character: string): string {
  return character.repeat(64);
}
