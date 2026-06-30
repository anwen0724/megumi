// @vitest-environment node
import { createHash } from 'node:crypto';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { WorkspaceChangeRepository } from '@megumi/coding-agent/persistence/repos/workspace-change.repo';
import { applyCodingAgentDatabaseMigrations } from '@megumi/coding-agent/persistence/schema/migrate';
import type {
  WorkspaceChangedFile,
  WorkspaceChangeSet,
  WorkspaceRestoreFileResult,
  WorkspaceRestoreRequest,
  WorkspaceRestoreResult,
  WorkspaceSnapshotContent,
} from '@megumi/shared/workspace';

let db: Database.Database | null = null;

function createRepo(): WorkspaceChangeRepository {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyCodingAgentDatabaseMigrations(db);
  seedLifecycle(db);
  return new WorkspaceChangeRepository(db);
}

afterEach(() => {
  db?.close();
  db = null;
});

describe('WorkspaceChangeRepository', () => {
  it('stores file snapshots in workspace_file_snapshots and reads raw content only through snapshots', () => {
    const repo = createRepo();
    const contentText = 'const greeting = "你好, Megumi";\n';
    const snapshot = snapshotContent({
      contentRefId: 'snapshot-unicode',
      contentText,
      sha256: hash(contentText),
      byteLength: byteLength(contentText),
      metadata: { source: 'before_snapshot' },
    });

    expect(repo.saveFileSnapshot(snapshot)).toEqual(snapshot);
    expect(repo.getSnapshotContent('snapshot-unicode')).toEqual(snapshot);

    const row = currentDb().prepare('SELECT * FROM workspace_file_snapshots WHERE snapshot_id = ?')
      .get('snapshot-unicode') as { snapshot_id: string; content_text: string; metadata_json: string };
    expect(row.snapshot_id).toBe('snapshot-unicode');
    expect(row.content_text).toBe(contentText);
    expect(JSON.parse(row.metadata_json)).toEqual({ userMetadata: { source: 'before_snapshot' } });
  });

  it('records workspace changes and changed files without checkpoint entity persistence', () => {
    const repo = createRepo();
    seedSnapshots(repo);

    expect(repo.recordWorkspaceChange(workspaceChangeSet())).toEqual(workspaceChangeSet());
    expect(repo.recordChangedFile(workspaceChangedFile())).toEqual(workspaceChangedFile());

    const finalized = repo.finalizeWorkspaceChange('change-set-1', '2026-06-05T10:05:00.000Z');
    expect(finalized).toEqual({
      ...workspaceChangeSet(),
      status: 'finalized',
      changedFileCount: 1,
      finalizedAt: '2026-06-05T10:05:00.000Z',
    });

    expect(repo.getWorkspaceChange('change-set-1')).toEqual(finalized);
    expect(repo.listWorkspaceChangesByRun('run-1').map((change) => change.changeSetId)).toEqual(['change-set-1']);
    expect(repo.getChangedFile('changed-file-1')).toEqual(workspaceChangedFile());
    expect(repo.listChangedFilesByChangeSet('change-set-1').map((file) => file.changedFileId)).toEqual(['changed-file-1']);
    expect(repo.listChangedFilesByRun('run-1').map((file) => file.changedFileId)).toEqual(['changed-file-1']);

    const changeRow = currentDb().prepare('SELECT metadata_json FROM workspace_changes WHERE change_id = ?')
      .get('change-set-1') as { metadata_json: string };
    const changedFileRow = currentDb().prepare('SELECT metadata_json FROM workspace_changed_files WHERE changed_file_id = ?')
      .get('changed-file-1') as { metadata_json: string };
    expect(JSON.parse(changeRow.metadata_json)).toEqual({
      userMetadata: { responseScope: 'assistant_message' },
      stepId: 'step-1',
      sourceEntryId: 'source-entry-1',
      responseMessageId: 'message-1',
    });
    expect(changeRow.metadata_json).not.toContain('workspaceCheckpointMap');
    expect(changedFileRow.metadata_json).toContain('workspaceCheckpointId');
  });

  it('summarizes changed file restore states from workspace_changed_files', () => {
    const repo = createRepo();
    seedSnapshots(repo);
    repo.recordWorkspaceChange(workspaceChangeSet());

    for (const changedFile of [
      workspaceChangedFile({ changedFileId: 'changed-file-restorable', restoreState: 'restorable' }),
      workspaceChangedFile({ changedFileId: 'changed-file-restored', restoreState: 'restored', updatedAt: '2026-06-05T10:03:01.000Z' }),
      workspaceChangedFile({ changedFileId: 'changed-file-conflict', restoreState: 'conflict', updatedAt: '2026-06-05T10:03:02.000Z' }),
      workspaceChangedFile({ changedFileId: 'changed-file-failed', restoreState: 'restore_failed', updatedAt: '2026-06-05T10:03:03.000Z' }),
    ]) {
      repo.recordChangedFile(changedFile);
    }

    expect(repo.getChangeSummary('change-set-1')).toEqual({
      changeSetId: 'change-set-1',
      sessionId: 'session-1',
      runId: 'run-1',
      changedFileCount: 4,
      restorableCount: 1,
      restoredCount: 1,
      conflictCount: 1,
      failedCount: 1,
      hasRestorableChanges: true,
      updatedAt: '2026-06-05T10:03:03.000Z',
    });
    expect(repo.listChangeSummariesByRun('run-1').map((summary) => summary.changeSetId)).toEqual(['change-set-1']);
  });

  it('stores restore request and result as one workspace_restore_operations lifecycle row', () => {
    const repo = createRepo();
    seedChange(repo);

    expect(repo.createRestoreOperation(restoreRequest())).toEqual(restoreRequest());
    expect(repo.updateRestoreOperation({
      restoreRequestId: 'restore-request-1',
      status: 'running',
      metadata: { source: 'ui', started: true },
    })).toEqual(expect.objectContaining({
      restoreRequestId: 'restore-request-1',
      status: 'running',
      metadata: { source: 'ui', started: true },
    }));
    expect(repo.completeRestoreOperation(restoreResult())).toEqual(restoreResult());

    const rows = currentDb().prepare('SELECT * FROM workspace_restore_operations ORDER BY restore_id ASC')
      .all() as Array<{ restore_id: string; status: string; result_json: string; metadata_json: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].restore_id).toBe('restore-request-1');
    expect(JSON.parse(rows[0].result_json)).toEqual(restoreResult());
    expect(JSON.parse(rows[0].metadata_json)).toEqual({
      userMetadata: { source: 'ui', started: true },
      resultMetadata: { fileCount: 1 },
    });
  });

  it('stores restore file outcomes in workspace_restore_file_results', () => {
    const repo = createRepo();
    seedChange(repo);
    repo.createRestoreOperation(restoreRequest());
    repo.completeRestoreOperation(restoreResult());

    const restoredFile = restoreFileResult();
    const conflictFile = restoreFileResult({
      restoreFileResultId: 'restore-file-result-conflict',
      status: 'conflict',
      conflictReason: 'current_hash_mismatch',
      restoredAt: '2026-06-05T10:06:03.000Z',
    });
    expect(repo.recordRestoreFileResult(restoredFile)).toEqual(restoredFile);
    expect(repo.recordRestoreFileResult(conflictFile)).toEqual(conflictFile);

    expect(repo.listRestoreFileResults('restore-result-1')).toEqual([restoredFile, conflictFile]);
    const rows = currentDb().prepare('SELECT * FROM workspace_restore_file_results ORDER BY file_result_id ASC')
      .all() as Array<{ file_result_id: string; restore_id: string; changed_file_id: string }>;
    expect(rows).toEqual([
      expect.objectContaining({
        file_result_id: 'restore-file-result-1',
        restore_id: 'restore-request-1',
        changed_file_id: 'changed-file-1',
      }),
      expect.objectContaining({
        file_result_id: 'restore-file-result-conflict',
        restore_id: 'restore-request-1',
        changed_file_id: 'changed-file-1',
      }),
    ]);
  });

  it('does not expose old checkpoint/request/result persistence methods', () => {
    const publicNames = Object.getOwnPropertyNames(WorkspaceChangeRepository.prototype);

    expect(publicNames).toEqual(expect.arrayContaining([
      'saveFileSnapshot',
      'recordWorkspaceChange',
      'recordChangedFile',
      'finalizeWorkspaceChange',
      'getWorkspaceChange',
      'listWorkspaceChangesByRun',
      'createRestoreOperation',
      'completeRestoreOperation',
      'recordRestoreFileResult',
      'listRestoreFileResults',
    ]));
    expect(publicNames).not.toEqual(expect.arrayContaining([
      'saveWorkspaceCheckpoint',
      'getWorkspaceCheckpoint',
      'listCheckpointsByChangeSet',
      'saveRestoreRequest',
      'getRestoreRequest',
      'saveRestoreResult',
      'getRestoreResult',
      'listRestoreResultsByChangeSet',
    ]));
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
  repo.recordWorkspaceChange(workspaceChangeSet());
  repo.recordChangedFile(workspaceChangedFile());
}

function seedSnapshots(repo: WorkspaceChangeRepository): void {
  repo.saveFileSnapshot(snapshotContent({
    contentRefId: 'snapshot-before',
    contentText: 'before',
    sha256: hash('before'),
    byteLength: byteLength('before'),
    createdAt: '2026-06-05T10:00:00.000Z',
  }));
  repo.saveFileSnapshot(snapshotContent({
    contentRefId: 'snapshot-after',
    contentText: 'after',
    sha256: hash('after'),
    byteLength: byteLength('after'),
    createdAt: '2026-06-05T10:00:01.000Z',
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
    contentText: 'before',
    sha256: hash('before'),
    byteLength: byteLength('before'),
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
    sourceEntryId: 'source-entry-1',
    responseMessageId: 'message-1',
    status: 'open',
    changedFileCount: 0,
    createdAt: '2026-06-05T10:01:00.000Z',
    metadata: { responseScope: 'assistant_message' },
    ...overrides,
  };
}

function workspaceChangedFile(overrides: Partial<WorkspaceChangedFile> = {}): WorkspaceChangedFile {
  return {
    changedFileId: 'changed-file-1',
    changeSetId: 'change-set-1',
    workspaceCheckpointId: 'changed-file-before-state-1',
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: 'step-1',
    toolCallId: 'tool-call-1',
    toolExecutionId: 'tool-execution-1',
    sourceEntryId: 'source-entry-1',
    responseMessageId: 'message-1',
    projectPath: 'src/app.ts',
    changeKind: 'modified',
    restoreState: 'restorable',
    beforeExists: true,
    beforeContentRefId: 'snapshot-before',
    beforeHash: hash('before'),
    beforeByteLength: 6,
    afterExists: true,
    afterContentRefId: 'snapshot-after',
    afterHash: hash('after'),
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
    INSERT INTO workspaces (
      workspace_id, name, root_path, root_path_key, status,
      created_at, updated_at, last_opened_at, metadata_json
    ) VALUES (
      'workspace-1', 'Workspace 1', '/workspace-1', '/workspace-1', 'available',
      '2026-06-05T09:00:00.000Z', '2026-06-05T09:00:00.000Z',
      '2026-06-05T09:00:00.000Z', NULL
    );

    INSERT INTO sessions (
      session_id, workspace_id, title, status, active_entry_id,
      created_at, updated_at, archived_at, metadata_json
    ) VALUES (
      'session-1', 'workspace-1', 'Workspace change session', 'active', NULL,
      '2026-06-05T09:00:00.000Z', '2026-06-05T09:00:00.000Z', NULL, NULL
    );

    INSERT INTO agent_loop_runs (
      run_id, workspace_id, session_id, run_kind, user_message_id,
      assistant_message_id, base_run_id, base_message_id, base_entry_id,
      attempt_number, status, permission_mode, permission_snapshot_json,
      memory_recall_trace_id, started_at, completed_at, cancelled_at,
      error_json, created_at, metadata_json
    ) VALUES (
      'run-1', 'workspace-1', 'session-1', 'input', NULL,
      NULL, NULL, NULL, NULL, 1, 'running', 'chat', NULL,
      NULL, '2026-06-05T09:01:00.000Z', NULL, NULL,
      NULL, '2026-06-05T09:01:00.000Z', NULL
    );

    INSERT INTO session_messages (
      message_id, session_id, run_id, role, status, content_text,
      blocks_json, created_at, completed_at, metadata_json
    ) VALUES (
      'message-1', 'session-1', 'run-1', 'assistant', 'completed',
      'Changed src/app.ts', NULL, '2026-06-05T09:02:00.000Z',
      '2026-06-05T09:02:00.000Z', NULL
    );

    INSERT INTO model_calls (
      model_call_id, run_id, call_order, provider_id, model_id, status,
      input_summary_json, context_snapshot_json, request_json, response_json,
      output_summary_json, token_usage_json, started_at, completed_at,
      error_json, metadata_json
    ) VALUES (
      'model-call-1', 'run-1', 1, 'openai-compatible', 'gpt-5', 'completed',
      NULL, NULL, NULL, NULL, NULL, NULL,
      '2026-06-05T09:02:30.000Z', '2026-06-05T09:02:40.000Z',
      NULL, NULL
    );

    INSERT INTO tool_calls (
      tool_call_id, run_id, model_call_id, call_order, provider_tool_call_id,
      tool_source_id, tool_name, model_visible_name, input_json, input_preview,
      status, permission_decision_json, approval_request_id, result_json,
      result_preview, observation_json, submitted_to_model_at, started_at,
      completed_at, error_json, metadata_json
    ) VALUES (
      'tool-call-1', 'run-1', 'model-call-1', 1, 'provider-tool-call-1',
      NULL, 'write_file', 'write_file', '{}', NULL, 'completed',
      NULL, NULL, NULL, NULL, NULL, NULL,
      '2026-06-05T09:03:00.000Z', '2026-06-05T09:03:01.000Z',
      NULL, '{"toolExecutionId":"tool-execution-1"}'
    );
  `);
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}
