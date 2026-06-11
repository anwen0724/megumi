// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  WORKSPACE_CHANGE_KINDS,
  WORKSPACE_CHANGE_SET_STATUSES,
  WORKSPACE_RESTORE_CONFLICT_REASONS,
  WORKSPACE_RESTORE_FILE_RESULT_STATUSES,
  WORKSPACE_RESTORE_REQUESTED_BY,
  WORKSPACE_RESTORE_REQUEST_STATUSES,
  WORKSPACE_RESTORE_RESULT_STATUSES,
  WORKSPACE_RESTORE_STATES,
  WORKSPACE_SNAPSHOT_CONTENT_ENCODINGS,
  WORKSPACE_SNAPSHOT_CONTENT_STORAGES,
  WorkspaceChangedFileSchema,
  WorkspaceChangeFooterFactSchema,
  WorkspaceChangeFooterFileSchema,
  WorkspaceChangeSetSchema,
  WorkspaceCheckpointSchema,
  WorkspaceRestoreFileResultSchema,
  WorkspaceRestoreResultSchema,
  WorkspaceSnapshotContentSchema,
} from '@megumi/shared/workspace';

const now = '2026-06-05T10:00:00.000Z';
const beforeHash = 'a'.repeat(64);
const afterHash = 'b'.repeat(64);
const writeFailedError = {
  code: 'filesystem_error',
  message: 'Workspace restore failed.',
  severity: 'error',
  retryable: false,
  source: 'filesystem',
} as const;

function changedFile(overrides: Record<string, unknown> = {}) {
  return {
    changedFileId: 'changed-file-1',
    changeSetId: 'change-set-1',
    workspaceCheckpointId: 'workspace-checkpoint-1',
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
    beforeContentRefId: 'content-ref-before',
    beforeHash,
    beforeByteLength: 12,
    afterExists: true,
    afterContentRefId: 'content-ref-after',
    afterHash,
    afterByteLength: 18,
    createdAt: now,
    updatedAt: now,
    metadata: { toolName: 'edit_file' },
    ...overrides,
  };
}

function restoreFileResult(overrides: Record<string, unknown> = {}) {
  return {
    restoreFileResultId: 'restore-file-result-1',
    restoreResultId: 'restore-result-1',
    changedFileId: 'changed-file-1',
    projectPath: 'src/app.ts',
    status: 'restored',
    restoredAt: now,
    metadata: { attempt: 1 },
    ...overrides,
  };
}

describe('workspace change contracts', () => {
  it('exports stable workspace change enum values', () => {
    expect(WORKSPACE_CHANGE_KINDS).toEqual(['created', 'modified', 'deleted']);
    expect(WORKSPACE_CHANGE_SET_STATUSES).toEqual(['open', 'finalized']);
    expect(WORKSPACE_RESTORE_STATES).toEqual([
      'restorable',
      'restored',
      'conflict',
      'restore_failed',
      'not_restorable',
    ]);
    expect(WORKSPACE_RESTORE_REQUEST_STATUSES).toEqual(['requested', 'running', 'completed', 'failed']);
    expect(WORKSPACE_RESTORE_RESULT_STATUSES).toEqual(['restored', 'partial', 'conflict', 'failed', 'noop']);
    expect(WORKSPACE_RESTORE_FILE_RESULT_STATUSES).toEqual(['restored', 'conflict', 'failed', 'noop']);
    expect(WORKSPACE_RESTORE_CONFLICT_REASONS).toEqual([
      'current_hash_mismatch',
      'current_file_missing',
      'current_file_exists',
      'path_outside_project',
      'snapshot_missing',
      'unsupported_file',
      'write_failed',
    ]);
    expect(WORKSPACE_RESTORE_REQUESTED_BY).toEqual(['user', 'host', 'system']);
    expect(WORKSPACE_SNAPSHOT_CONTENT_STORAGES).toEqual(['sqlite_text']);
    expect(WORKSPACE_SNAPSHOT_CONTENT_ENCODINGS).toEqual(['utf8']);
  });

  it('accepts valid modified file change with before and after hashes', () => {
    const parsed = WorkspaceChangedFileSchema.parse(changedFile());

    expect(parsed.changeKind).toBe('modified');
    expect(parsed.beforeHash).toBe(beforeHash);
    expect(parsed.afterHash).toBe(afterHash);
  });

  it('accepts created and deleted invariants', () => {
    expect(
      WorkspaceChangedFileSchema.parse(
        changedFile({
          changeKind: 'created',
          beforeExists: false,
          beforeContentRefId: undefined,
          beforeHash: undefined,
          beforeByteLength: undefined,
          afterExists: true,
        }),
      ).changeKind,
    ).toBe('created');

    expect(
      WorkspaceChangedFileSchema.parse(
        changedFile({
          changeKind: 'deleted',
          beforeExists: true,
          afterExists: false,
          afterContentRefId: undefined,
          afterHash: undefined,
          afterByteLength: undefined,
        }),
      ).changeKind,
    ).toBe('deleted');
  });

  it('rejects absolute, parent traversal, and backslash project paths', () => {
    for (const projectPath of [
      'C:/project/src/app.ts',
      '/project/src/app.ts',
      '../src/app.ts',
      'src/../app.ts',
      'src\\app.ts',
    ]) {
      expect(WorkspaceChangedFileSchema.safeParse(changedFile({ projectPath })).success).toBe(false);
    }
  });

  it('rejects invalid hashes', () => {
    expect(WorkspaceSnapshotContentSchema.safeParse({
      contentRefId: 'content-ref-1',
      sessionId: 'session-1',
      runId: 'run-1',
      projectPath: 'src/app.ts',
      storage: 'sqlite_text',
      encoding: 'utf8',
      sha256: 'not-a-sha256',
      byteLength: 12,
      contentText: 'hello world',
      createdAt: now,
    }).success).toBe(false);

    expect(WorkspaceChangedFileSchema.safeParse(changedFile({ beforeHash: 'g'.repeat(64) })).success).toBe(false);
  });

  it('rejects created, modified, and deleted invariant mismatches', () => {
    expect(WorkspaceChangedFileSchema.safeParse(changedFile({
      changeKind: 'created',
      beforeExists: true,
      afterExists: true,
    })).success).toBe(false);

    expect(WorkspaceChangedFileSchema.safeParse(changedFile({
      changeKind: 'modified',
      beforeExists: false,
      beforeContentRefId: undefined,
      beforeHash: undefined,
      beforeByteLength: undefined,
      afterExists: true,
    })).success).toBe(false);

    expect(WorkspaceChangedFileSchema.safeParse(changedFile({
      changeKind: 'deleted',
      beforeExists: true,
      afterExists: true,
    })).success).toBe(false);
  });

  it('rejects missing finalizedAt on finalized change set', () => {
    expect(WorkspaceChangeSetSchema.safeParse({
      changeSetId: 'change-set-1',
      sessionId: 'session-1',
      runId: 'run-1',
      status: 'finalized',
      changedFileCount: 1,
      createdAt: now,
    }).success).toBe(false);
  });

  it('rejects conflict file result without conflict reason', () => {
    expect(WorkspaceRestoreFileResultSchema.safeParse(restoreFileResult({
      status: 'conflict',
      restoredAt: undefined,
    })).success).toBe(false);
  });

  it('rejects failed file result without error', () => {
    expect(WorkspaceRestoreFileResultSchema.safeParse(restoreFileResult({
      status: 'failed',
      restoredAt: undefined,
    })).success).toBe(false);
  });

  it('rejects failed file result with conflict reason even when error is present', () => {
    expect(WorkspaceRestoreFileResultSchema.safeParse(restoreFileResult({
      status: 'failed',
      conflictReason: 'write_failed',
      error: writeFailedError,
      restoredAt: undefined,
    })).success).toBe(false);
  });

  it('rejects terminal restored and noop file results with conflict reason or error', () => {
    for (const status of ['restored', 'noop'] as const) {
      expect(WorkspaceRestoreFileResultSchema.safeParse(restoreFileResult({
        status,
        conflictReason: 'current_hash_mismatch',
      })).success).toBe(false);

      expect(WorkspaceRestoreFileResultSchema.safeParse(restoreFileResult({
        status,
        error: writeFailedError,
      })).success).toBe(false);
    }
  });

  it('rejects conflict file result with error', () => {
    expect(WorkspaceRestoreFileResultSchema.safeParse(restoreFileResult({
      status: 'conflict',
      conflictReason: 'current_hash_mismatch',
      error: writeFailedError,
      restoredAt: undefined,
    })).success).toBe(false);
  });

  it('rejects restorable modified and deleted changes without before content ref', () => {
    expect(WorkspaceChangedFileSchema.safeParse(changedFile({
      changeKind: 'modified',
      restoreState: 'restorable',
      beforeContentRefId: undefined,
    })).success).toBe(false);

    expect(WorkspaceChangedFileSchema.safeParse(changedFile({
      changeKind: 'deleted',
      restoreState: 'restorable',
      beforeContentRefId: undefined,
      afterExists: false,
      afterContentRefId: undefined,
      afterHash: undefined,
      afterByteLength: undefined,
    })).success).toBe(false);
  });

  it('rejects failed aggregate restore result without error', () => {
    expect(WorkspaceRestoreResultSchema.safeParse({
      restoreResultId: 'restore-result-1',
      restoreRequestId: 'restore-request-1',
      changeSetId: 'change-set-1',
      sessionId: 'session-1',
      runId: 'run-1',
      status: 'failed',
      restoredAt: now,
    }).success).toBe(false);
  });

  it('rejects unknown raw content fields through strict schemas', () => {
    expect(WorkspaceSnapshotContentSchema.safeParse({
      contentRefId: 'content-ref-1',
      sessionId: 'session-1',
      runId: 'run-1',
      projectPath: 'src/app.ts',
      storage: 'sqlite_text',
      encoding: 'utf8',
      sha256: beforeHash,
      byteLength: 12,
      contentText: 'hello world',
      createdAt: now,
      rawContent: 'raw content',
    }).success).toBe(false);

    expect(WorkspaceCheckpointSchema.safeParse({
      workspaceCheckpointId: 'workspace-checkpoint-1',
      sessionId: 'session-1',
      runId: 'run-1',
      projectPath: 'src/app.ts',
      beforeExists: true,
      beforeContentRefId: 'content-ref-before',
      beforeHash,
      beforeByteLength: 12,
      createdAt: now,
      rawBeforeContent: 'raw before content',
    }).success).toBe(false);

    expect(WorkspaceChangedFileSchema.safeParse(changedFile({
      rawAfterContent: 'raw after content',
    })).success).toBe(false);
  });

  it('parses workspace change footer facts without raw snapshot content or absolute paths', () => {
    const fact = WorkspaceChangeFooterFactSchema.parse({
      runId: 'run-1',
      sessionId: 'session-1',
      updatedAt: '2026-06-06T10:00:00.000Z',
      changeSets: [{
        changeSetId: 'workspace-change-set-1',
        changedFileCount: 2,
        restorableCount: 2,
        restoredCount: 0,
        conflictCount: 0,
        failedCount: 0,
        hasRestorableChanges: true,
        files: [
          {
            changedFileId: 'workspace-changed-file-1',
            projectPath: 'AGENTS.md',
            changeKind: 'modified',
            restoreState: 'restorable',
          },
          {
            changedFileId: 'workspace-changed-file-2',
            projectPath: '.local-docs/status/capability-map.md',
            changeKind: 'modified',
            restoreState: 'restorable',
          },
        ],
      }],
    });

    expect(fact.changeSets[0]?.files.map((file) => file.projectPath)).toEqual([
      'AGENTS.md',
      '.local-docs/status/capability-map.md',
    ]);
    expect(JSON.stringify(fact)).not.toContain('contentText');
    expect(JSON.stringify(fact)).not.toContain('beforeHash');
    expect(JSON.stringify(fact)).not.toContain('afterHash');
    expect(JSON.stringify(fact)).not.toContain('C:/');
  });

  it('rejects unsafe workspace change footer file paths and raw snapshot fields', () => {
    expect(() => WorkspaceChangeFooterFileSchema.parse({
      changedFileId: 'workspace-changed-file-1',
      projectPath: '../outside.txt',
      changeKind: 'modified',
      restoreState: 'restorable',
    })).toThrow();

    expect(() => WorkspaceChangeFooterFileSchema.parse({
      changedFileId: 'workspace-changed-file-1',
      projectPath: 'src/app.ts',
      changeKind: 'modified',
      restoreState: 'restorable',
      contentText: 'raw snapshot must not leak',
    })).toThrow();
  });
});

