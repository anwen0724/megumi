// @vitest-environment node
import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';
import type {
  WorkspaceChangedFile,
  WorkspaceChangeSet,
  WorkspaceChangeSummary,
  WorkspaceRestoreFileResult,
  WorkspaceRestoreRequest,
  WorkspaceRestoreResult,
  WorkspaceSnapshotContent,
} from '@megumi/shared/workspace';
import {
  WorkspaceRestoreService,
  type WorkspaceRestoreFileSystem,
  type WorkspaceRestoreRepositoryPort,
} from '@megumi/desktop/main/services/workspace/workspace-restore.service';

describe('WorkspaceRestoreService', () => {
  it('restores a modified file only when current content matches recorded after hash', async () => {
    const files = new Map<string, string>([
      ['C:\\project\\src\\app.ts', 'after'],
    ]);
    const repository = fakeRepository({
      changedFiles: [changedFile({
        changeKind: 'modified',
        beforeExists: true,
        beforeContentRefId: 'before-ref',
        beforeHash: sha256('before'),
        beforeByteLength: 6,
        afterExists: true,
        afterContentRefId: 'after-ref',
        afterHash: sha256('after'),
        afterByteLength: 5,
      })],
      snapshots: [
        snapshot('before-ref', 'before'),
        snapshot('after-ref', 'after'),
      ],
    });
    const service = createService({ files, repository });

    const outcome = await service.restoreChangeSet({
      changeSetId: 'change-set-1',
      requestedBy: 'user',
    });

    expect(outcome.result.status).toBe('restored');
    expect(outcome.result.metadata).toEqual({
      changedFileCount: 1,
      restoredCount: 1,
      conflictCount: 0,
      failedCount: 0,
      noopCount: 0,
    });
    expect(files.get('C:\\project\\src\\app.ts')).toBe('before');
    expect(repository.saveRestoreFileResult).toHaveBeenCalledWith(expect.objectContaining({
      status: 'restored',
      projectPath: 'src/app.ts',
      restoredAt: '2026-06-05T10:00:01.000Z',
    }));
    expect(repository.updateChangedFileRestoreState).toHaveBeenCalledWith(expect.objectContaining({
      changedFileId: 'changed-file-1',
      restoreState: 'restored',
      metadata: expect.objectContaining({
        restoreRequestId: 'restore-request-1',
        restoreResultId: 'restore-result-1',
      }),
    }));
    expect(repository.updateRestoreRequestStatus).toHaveBeenNthCalledWith(1, expect.objectContaining({
      restoreRequestId: 'restore-request-1',
      status: 'running',
    }));
    expect(repository.updateRestoreRequestStatus).toHaveBeenLastCalledWith(expect.objectContaining({
      restoreRequestId: 'restore-request-1',
      status: 'completed',
      completedAt: '2026-06-05T10:00:01.000Z',
    }));
  });

  it('records conflict for modified file when current hash differs and does not overwrite', async () => {
    const files = new Map<string, string>([
      ['C:\\project\\src\\app.ts', 'external edit'],
    ]);
    const repository = fakeRepository({
      changedFiles: [changedFile({
        changeKind: 'modified',
        beforeExists: true,
        beforeContentRefId: 'before-ref',
        beforeHash: sha256('before'),
        beforeByteLength: 6,
        afterExists: true,
        afterContentRefId: 'after-ref',
        afterHash: sha256('after'),
        afterByteLength: 5,
      })],
      snapshots: [
        snapshot('before-ref', 'before'),
        snapshot('after-ref', 'after'),
      ],
    });
    const service = createService({ files, repository });

    const outcome = await service.restoreChangeSet({
      changeSetId: 'change-set-1',
      requestedBy: 'user',
    });

    expect(outcome.result.status).toBe('conflict');
    expect(files.get('C:\\project\\src\\app.ts')).toBe('external edit');
    expect(repository.saveRestoreFileResult).toHaveBeenCalledWith(expect.objectContaining({
      status: 'conflict',
      conflictReason: 'current_hash_mismatch',
    }));
    expect(repository.updateChangedFileRestoreState).toHaveBeenCalledWith(expect.objectContaining({
      restoreState: 'conflict',
      metadata: expect.objectContaining({ conflictReason: 'current_hash_mismatch' }),
    }));
  });

  it('deletes a created file when current content still matches after hash', async () => {
    const files = new Map<string, string>([
      ['C:\\project\\src\\new.ts', 'new file'],
    ]);
    const repository = fakeRepository({
      changedFiles: [changedFile({
        projectPath: 'src/new.ts',
        changeKind: 'created',
        beforeExists: false,
        afterExists: true,
        afterContentRefId: 'after-ref',
        afterHash: sha256('new file'),
        afterByteLength: 8,
      })],
      snapshots: [snapshot('after-ref', 'new file', { projectPath: 'src/new.ts' })],
    });
    const service = createService({ files, repository });

    const outcome = await service.restoreChangeSet({
      changeSetId: 'change-set-1',
      requestedBy: 'user',
    });

    expect(outcome.result.status).toBe('restored');
    expect(files.has('C:\\project\\src\\new.ts')).toBe(false);
    expect(repository.updateChangedFileRestoreState).toHaveBeenCalledWith(expect.objectContaining({
      restoreState: 'restored',
    }));
  });

  it('treats an already missing created file as restored noop', async () => {
    const files = new Map<string, string>();
    const repository = fakeRepository({
      changedFiles: [changedFile({
        projectPath: 'src/new.ts',
        changeKind: 'created',
        beforeExists: false,
        afterExists: true,
        afterContentRefId: 'after-ref',
        afterHash: sha256('new file'),
        afterByteLength: 8,
      })],
      snapshots: [snapshot('after-ref', 'new file', { projectPath: 'src/new.ts' })],
    });
    const service = createService({ files, repository });

    const outcome = await service.restoreChangeSet({
      changeSetId: 'change-set-1',
      requestedBy: 'user',
    });

    expect(outcome.result.status).toBe('noop');
    expect(repository.saveRestoreFileResult).toHaveBeenCalledWith(expect.objectContaining({
      status: 'noop',
      metadata: { alreadyAbsent: true },
    }));
    expect(repository.updateChangedFileRestoreState).toHaveBeenCalledWith(expect.objectContaining({
      restoreState: 'restored',
      metadata: expect.objectContaining({ alreadyAbsent: true }),
    }));
  });

  it('restores a deleted file only when it is still missing', async () => {
    const files = new Map<string, string>();
    const repository = fakeRepository({
      changedFiles: [changedFile({
        projectPath: 'src/deleted.ts',
        changeKind: 'deleted',
        beforeExists: true,
        beforeContentRefId: 'before-ref',
        beforeHash: sha256('old file'),
        beforeByteLength: 8,
        afterExists: false,
      })],
      snapshots: [snapshot('before-ref', 'old file', { projectPath: 'src/deleted.ts' })],
    });
    const service = createService({ files, repository });

    const outcome = await service.restoreChangeSet({
      changeSetId: 'change-set-1',
      requestedBy: 'user',
    });

    expect(outcome.result.status).toBe('restored');
    expect(files.get('C:\\project\\src\\deleted.ts')).toBe('old file');
    expect(repository.saveRestoreFileResult).toHaveBeenCalledWith(expect.objectContaining({
      status: 'restored',
      projectPath: 'src/deleted.ts',
    }));
  });

  it('partially restores safe files and records conflicts for unsafe files', async () => {
    const files = new Map<string, string>([
      ['C:\\project\\src\\safe.ts', 'after safe'],
      ['C:\\project\\src\\unsafe.ts', 'external edit'],
    ]);
    const repository = fakeRepository({
      changedFiles: [
        changedFile({
          changedFileId: 'changed-file-safe',
          projectPath: 'src/safe.ts',
          changeKind: 'modified',
          beforeExists: true,
          beforeContentRefId: 'before-safe-ref',
          beforeHash: sha256('before safe'),
          beforeByteLength: 11,
          afterExists: true,
          afterContentRefId: 'after-safe-ref',
          afterHash: sha256('after safe'),
          afterByteLength: 10,
        }),
        changedFile({
          changedFileId: 'changed-file-unsafe',
          projectPath: 'src/unsafe.ts',
          changeKind: 'modified',
          beforeExists: true,
          beforeContentRefId: 'before-unsafe-ref',
          beforeHash: sha256('before unsafe'),
          beforeByteLength: 13,
          afterExists: true,
          afterContentRefId: 'after-unsafe-ref',
          afterHash: sha256('after unsafe'),
          afterByteLength: 12,
        }),
      ],
      snapshots: [
        snapshot('before-safe-ref', 'before safe', { projectPath: 'src/safe.ts' }),
        snapshot('after-safe-ref', 'after safe', { projectPath: 'src/safe.ts' }),
        snapshot('before-unsafe-ref', 'before unsafe', { projectPath: 'src/unsafe.ts' }),
        snapshot('after-unsafe-ref', 'after unsafe', { projectPath: 'src/unsafe.ts' }),
      ],
    });
    const service = createService({ files, repository });

    const outcome = await service.restoreChangeSet({
      changeSetId: 'change-set-1',
      requestedBy: 'user',
    });

    expect(outcome.result.status).toBe('partial');
    expect(outcome.result.metadata).toEqual({
      changedFileCount: 2,
      restoredCount: 1,
      conflictCount: 1,
      failedCount: 0,
      noopCount: 0,
    });
    expect(files.get('C:\\project\\src\\safe.ts')).toBe('before safe');
    expect(files.get('C:\\project\\src\\unsafe.ts')).toBe('external edit');
    expect(repository.saveRestoreFileResult).toHaveBeenCalledWith(expect.objectContaining({
      changedFileId: 'changed-file-safe',
      status: 'restored',
    }));
    expect(repository.saveRestoreFileResult).toHaveBeenCalledWith(expect.objectContaining({
      changedFileId: 'changed-file-unsafe',
      status: 'conflict',
      conflictReason: 'current_hash_mismatch',
    }));
  });

  it('prevalidates all changed-file paths before mutating any file', async () => {
    const files = new Map<string, string>([
      ['C:\\project\\src\\safe.ts', 'after safe'],
    ]);
    const repository = fakeRepository({
      changedFiles: [
        changedFile({
          changedFileId: 'changed-file-safe',
          projectPath: 'src/safe.ts',
          changeKind: 'modified',
          beforeExists: true,
          beforeContentRefId: 'before-safe-ref',
          beforeHash: sha256('before safe'),
          beforeByteLength: 11,
          afterExists: true,
          afterContentRefId: 'after-safe-ref',
          afterHash: sha256('after safe'),
          afterByteLength: 10,
        }),
        changedFile({
          changedFileId: 'changed-file-escape',
          projectPath: '../outside.ts',
          changeKind: 'modified',
          beforeExists: true,
          beforeContentRefId: 'before-escape-ref',
          beforeHash: sha256('before escape'),
          beforeByteLength: 13,
          afterExists: true,
          afterContentRefId: 'after-escape-ref',
          afterHash: sha256('after escape'),
          afterByteLength: 12,
        }),
      ],
      snapshots: [
        snapshot('before-safe-ref', 'before safe', { projectPath: 'src/safe.ts' }),
        snapshot('after-safe-ref', 'after safe', { projectPath: 'src/safe.ts' }),
        snapshot('before-escape-ref', 'before escape', { projectPath: '../outside.ts' }),
        snapshot('after-escape-ref', 'after escape', { projectPath: '../outside.ts' }),
      ],
    });
    const service = createService({ files, repository });

    const outcome = await service.restoreChangeSet({
      changeSetId: 'change-set-1',
      requestedBy: 'user',
    });

    expect(outcome.result.status).toBe('conflict');
    expect(files.get('C:\\project\\src\\safe.ts')).toBe('after safe');
    expect(repository.saveRestoreFileResult).toHaveBeenCalledWith(expect.objectContaining({
      changedFileId: 'changed-file-safe',
      status: 'conflict',
      conflictReason: 'path_outside_project',
    }));
    expect(repository.saveRestoreFileResult).toHaveBeenCalledWith(expect.objectContaining({
      changedFileId: 'changed-file-escape',
      status: 'conflict',
      conflictReason: 'path_outside_project',
    }));
    expect(repository.updateChangedFileRestoreState).toHaveBeenCalledWith(expect.objectContaining({
      changedFileId: 'changed-file-safe',
      restoreState: 'conflict',
      metadata: expect.objectContaining({ conflictReason: 'path_outside_project' }),
    }));
    expect(repository.updateChangedFileRestoreState).toHaveBeenCalledWith(expect.objectContaining({
      changedFileId: 'changed-file-escape',
      restoreState: 'conflict',
      metadata: expect.objectContaining({ conflictReason: 'path_outside_project' }),
    }));
  });

  it('does not leak snapshot content into restore persistence metadata or file results', async () => {
    const files = new Map<string, string>([
      ['C:\\project\\src\\secret.ts', 'after secret'],
    ]);
    const repository = fakeRepository({
      changedFiles: [changedFile({
        projectPath: 'src/secret.ts',
        changeKind: 'modified',
        beforeExists: true,
        beforeContentRefId: 'before-secret-ref',
        beforeHash: sha256('before secret'),
        beforeByteLength: 13,
        afterExists: true,
        afterContentRefId: 'after-secret-ref',
        afterHash: sha256('after secret'),
        afterByteLength: 12,
      })],
      snapshots: [
        snapshot('before-secret-ref', 'before secret', { projectPath: 'src/secret.ts' }),
        snapshot('after-secret-ref', 'after secret', { projectPath: 'src/secret.ts' }),
      ],
    });
    const service = createService({ files, repository });

    await service.restoreChangeSet({
      changeSetId: 'change-set-1',
      requestedBy: 'user',
      metadata: { source: 'test' },
    });

    const persistedCalls = [
      repository.saveRestoreRequest.mock.calls,
      repository.updateRestoreRequestStatus.mock.calls,
      repository.saveRestoreResult.mock.calls,
      repository.saveRestoreFileResult.mock.calls,
      repository.updateChangedFileRestoreState.mock.calls,
    ];
    const serialized = JSON.stringify(persistedCalls);
    expect(serialized).not.toContain('before secret');
    expect(serialized).not.toContain('after secret');
    expect(files.get('C:\\project\\src\\secret.ts')).toBe('before secret');
  });

  it('records filesystem write failures and continues restoring other files', async () => {
    const files = new Map<string, string>([
      ['C:\\project\\src\\fail.ts', 'after fail'],
      ['C:\\project\\src\\safe.ts', 'after safe'],
    ]);
    const fileSystem = fakeFileSystem(files, { failWrites: new Set(['C:\\project\\src\\fail.ts']) });
    const repository = fakeRepository({
      changedFiles: [
        changedFile({
          changedFileId: 'changed-file-fail',
          projectPath: 'src/fail.ts',
          changeKind: 'modified',
          beforeExists: true,
          beforeContentRefId: 'before-fail-ref',
          beforeHash: sha256('before fail'),
          beforeByteLength: 11,
          afterExists: true,
          afterContentRefId: 'after-fail-ref',
          afterHash: sha256('after fail'),
          afterByteLength: 10,
        }),
        changedFile({
          changedFileId: 'changed-file-safe',
          projectPath: 'src/safe.ts',
          changeKind: 'modified',
          beforeExists: true,
          beforeContentRefId: 'before-safe-ref',
          beforeHash: sha256('before safe'),
          beforeByteLength: 11,
          afterExists: true,
          afterContentRefId: 'after-safe-ref',
          afterHash: sha256('after safe'),
          afterByteLength: 10,
        }),
      ],
      snapshots: [
        snapshot('before-fail-ref', 'before fail', { projectPath: 'src/fail.ts' }),
        snapshot('after-fail-ref', 'after fail', { projectPath: 'src/fail.ts' }),
        snapshot('before-safe-ref', 'before safe', { projectPath: 'src/safe.ts' }),
        snapshot('after-safe-ref', 'after safe', { projectPath: 'src/safe.ts' }),
      ],
    });
    const service = createService({ files, repository, fileSystem });

    const outcome = await service.restoreChangeSet({
      changeSetId: 'change-set-1',
      requestedBy: 'user',
    });

    expect(outcome.result.status).toBe('partial');
    expect(files.get('C:\\project\\src\\fail.ts')).toBe('after fail');
    expect(files.get('C:\\project\\src\\safe.ts')).toBe('before safe');
    expect(repository.saveRestoreFileResult).toHaveBeenCalledWith(expect.objectContaining({
      changedFileId: 'changed-file-fail',
      status: 'failed',
      error: expect.objectContaining({
        code: 'filesystem_error',
        message: 'Workspace restore filesystem operation failed.',
        severity: 'error',
        retryable: false,
        source: 'workspace',
      }),
    }));
    expect(repository.updateChangedFileRestoreState).toHaveBeenCalledWith(expect.objectContaining({
      changedFileId: 'changed-file-fail',
      restoreState: 'restore_failed',
    }));
  });

  it('records filesystem read failures and continues restoring later files', async () => {
    const files = new Map<string, string>([
      ['C:\\project\\src\\fail.ts', 'after fail'],
      ['C:\\project\\src\\safe.ts', 'after safe'],
    ]);
    const fileSystem = fakeFileSystem(files, { failReads: new Set(['C:\\project\\src\\fail.ts']) });
    const repository = fakeRepository({
      changedFiles: [
        changedFile({
          changedFileId: 'changed-file-fail',
          projectPath: 'src/fail.ts',
          changeKind: 'modified',
          beforeExists: true,
          beforeContentRefId: 'before-fail-ref',
          beforeHash: sha256('before fail'),
          beforeByteLength: 11,
          afterExists: true,
          afterContentRefId: 'after-fail-ref',
          afterHash: sha256('after fail'),
          afterByteLength: 10,
        }),
        changedFile({
          changedFileId: 'changed-file-safe',
          projectPath: 'src/safe.ts',
          changeKind: 'modified',
          beforeExists: true,
          beforeContentRefId: 'before-safe-ref',
          beforeHash: sha256('before safe'),
          beforeByteLength: 11,
          afterExists: true,
          afterContentRefId: 'after-safe-ref',
          afterHash: sha256('after safe'),
          afterByteLength: 10,
        }),
      ],
      snapshots: [
        snapshot('before-fail-ref', 'before fail', { projectPath: 'src/fail.ts' }),
        snapshot('after-fail-ref', 'after fail', { projectPath: 'src/fail.ts' }),
        snapshot('before-safe-ref', 'before safe', { projectPath: 'src/safe.ts' }),
        snapshot('after-safe-ref', 'after safe', { projectPath: 'src/safe.ts' }),
      ],
    });
    const service = createService({ files, repository, fileSystem });

    const outcome = await service.restoreChangeSet({
      changeSetId: 'change-set-1',
      requestedBy: 'user',
    });

    expect(outcome.result.status).toBe('partial');
    expect(outcome.result.metadata).toEqual({
      changedFileCount: 2,
      restoredCount: 1,
      conflictCount: 0,
      failedCount: 1,
      noopCount: 0,
    });
    expect(files.get('C:\\project\\src\\fail.ts')).toBe('after fail');
    expect(files.get('C:\\project\\src\\safe.ts')).toBe('before safe');
    expect(repository.saveRestoreFileResult).toHaveBeenCalledWith(expect.objectContaining({
      changedFileId: 'changed-file-fail',
      status: 'failed',
      error: expect.objectContaining({
        code: 'filesystem_error',
        message: 'Workspace restore filesystem operation failed.',
        severity: 'error',
        retryable: false,
        source: 'workspace',
      }),
    }));
    expect(repository.updateChangedFileRestoreState).toHaveBeenCalledWith(expect.objectContaining({
      changedFileId: 'changed-file-fail',
      restoreState: 'restore_failed',
    }));
    expect(repository.updateChangedFileRestoreState).toHaveBeenCalledWith(expect.objectContaining({
      changedFileId: 'changed-file-safe',
      restoreState: 'restored',
    }));
  });

  it('reports partial when restore outcomes mix conflict and filesystem failure', async () => {
    const files = new Map<string, string>([
      ['C:\\project\\src\\conflict.ts', 'external edit'],
      ['C:\\project\\src\\fail.ts', 'after fail'],
    ]);
    const fileSystem = fakeFileSystem(files, { failWrites: new Set(['C:\\project\\src\\fail.ts']) });
    const repository = fakeRepository({
      changedFiles: [
        changedFile({
          changedFileId: 'changed-file-conflict',
          projectPath: 'src/conflict.ts',
          changeKind: 'modified',
          beforeExists: true,
          beforeContentRefId: 'before-conflict-ref',
          beforeHash: sha256('before conflict'),
          beforeByteLength: 15,
          afterExists: true,
          afterContentRefId: 'after-conflict-ref',
          afterHash: sha256('after conflict'),
          afterByteLength: 14,
        }),
        changedFile({
          changedFileId: 'changed-file-fail',
          projectPath: 'src/fail.ts',
          changeKind: 'modified',
          beforeExists: true,
          beforeContentRefId: 'before-fail-ref',
          beforeHash: sha256('before fail'),
          beforeByteLength: 11,
          afterExists: true,
          afterContentRefId: 'after-fail-ref',
          afterHash: sha256('after fail'),
          afterByteLength: 10,
        }),
      ],
      snapshots: [
        snapshot('before-conflict-ref', 'before conflict', { projectPath: 'src/conflict.ts' }),
        snapshot('after-conflict-ref', 'after conflict', { projectPath: 'src/conflict.ts' }),
        snapshot('before-fail-ref', 'before fail', { projectPath: 'src/fail.ts' }),
        snapshot('after-fail-ref', 'after fail', { projectPath: 'src/fail.ts' }),
      ],
    });
    const service = createService({ files, repository, fileSystem });

    const outcome = await service.restoreChangeSet({
      changeSetId: 'change-set-1',
      requestedBy: 'user',
    });

    expect(outcome.result.status).toBe('partial');
    expect(outcome.result.metadata).toEqual({
      changedFileCount: 2,
      restoredCount: 0,
      conflictCount: 1,
      failedCount: 1,
      noopCount: 0,
    });
    expect(files.get('C:\\project\\src\\conflict.ts')).toBe('external edit');
    expect(files.get('C:\\project\\src\\fail.ts')).toBe('after fail');
  });

  it('marks the restore request failed when result persistence throws after running', async () => {
    const files = new Map<string, string>([
      ['C:\\project\\src\\secret.ts', 'after secret'],
    ]);
    const repository = fakeRepository({
      changedFiles: [changedFile({
        projectPath: 'src/secret.ts',
        changeKind: 'modified',
        beforeExists: true,
        beforeContentRefId: 'before-secret-ref',
        beforeHash: sha256('before secret'),
        beforeByteLength: 13,
        afterExists: true,
        afterContentRefId: 'after-secret-ref',
        afterHash: sha256('after secret'),
        afterByteLength: 12,
      })],
      snapshots: [
        snapshot('before-secret-ref', 'before secret', { projectPath: 'src/secret.ts' }),
        snapshot('after-secret-ref', 'after secret', { projectPath: 'src/secret.ts' }),
      ],
    });
    repository.saveRestoreResult.mockImplementation(() => {
      throw new Error('persist result failed');
    });
    const service = createService({ files, repository });

    await expect(service.restoreChangeSet({
      changeSetId: 'change-set-1',
      requestedBy: 'user',
    })).rejects.toThrow('persist result failed');

    expect(repository.updateRestoreRequestStatus).toHaveBeenCalledWith(expect.objectContaining({
      restoreRequestId: 'restore-request-1',
      status: 'running',
    }));
    expect(repository.updateRestoreRequestStatus).toHaveBeenCalledWith(expect.objectContaining({
      restoreRequestId: 'restore-request-1',
      status: 'failed',
      completedAt: expect.any(String),
    }));
    expect(JSON.stringify(repository.updateRestoreRequestStatus.mock.calls)).not.toContain('before secret');
    expect(JSON.stringify(repository.updateRestoreRequestStatus.mock.calls)).not.toContain('after secret');
    expect(repository.updateChangedFileRestoreState).not.toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ restoreResultId: 'restore-result-1' }),
    }));
  });

  it('does not update changed-file state to a missing result when file result persistence throws', async () => {
    const files = new Map<string, string>([
      ['C:\\project\\src\\secret.ts', 'after secret'],
    ]);
    const repository = fakeRepository({
      changedFiles: [changedFile({
        projectPath: 'src/secret.ts',
        changeKind: 'modified',
        beforeExists: true,
        beforeContentRefId: 'before-secret-ref',
        beforeHash: sha256('before secret'),
        beforeByteLength: 13,
        afterExists: true,
        afterContentRefId: 'after-secret-ref',
        afterHash: sha256('after secret'),
        afterByteLength: 12,
      })],
      snapshots: [
        snapshot('before-secret-ref', 'before secret', { projectPath: 'src/secret.ts' }),
        snapshot('after-secret-ref', 'after secret', { projectPath: 'src/secret.ts' }),
      ],
    });
    repository.saveRestoreFileResult.mockImplementation(() => {
      throw new Error('persist file result failed');
    });
    const service = createService({ files, repository });

    await expect(service.restoreChangeSet({
      changeSetId: 'change-set-1',
      requestedBy: 'user',
    })).rejects.toThrow('persist file result failed');

    expect(repository.saveRestoreResult).toHaveBeenCalledWith(expect.objectContaining({
      restoreResultId: 'restore-result-1',
      status: 'restored',
    }));
    expect(repository.updateRestoreRequestStatus).toHaveBeenCalledWith(expect.objectContaining({
      restoreRequestId: 'restore-request-1',
      status: 'failed',
      completedAt: expect.any(String),
    }));
    expect(repository.updateChangedFileRestoreState).not.toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ restoreResultId: 'restore-result-1' }),
    }));
    expect(JSON.stringify(repository.updateRestoreRequestStatus.mock.calls)).not.toContain('before secret');
    expect(JSON.stringify(repository.updateRestoreRequestStatus.mock.calls)).not.toContain('after secret');
  });

  it('treats an already restored modified file as noop without recording a conflict', async () => {
    const files = new Map<string, string>([
      ['C:\\project\\src\\app.ts', 'before'],
    ]);
    const repository = fakeRepository({
      changedFiles: [changedFile({
        changeKind: 'modified',
        restoreState: 'restored',
        beforeExists: true,
        beforeContentRefId: 'before-ref',
        beforeHash: sha256('before'),
        beforeByteLength: 6,
        afterExists: true,
        afterContentRefId: 'after-ref',
        afterHash: sha256('after'),
        afterByteLength: 5,
      })],
      snapshots: [
        snapshot('before-ref', 'before'),
        snapshot('after-ref', 'after'),
      ],
    });
    const service = createService({ files, repository });

    const outcome = await service.restoreChangeSet({
      changeSetId: 'change-set-1',
      requestedBy: 'user',
    });

    expect(outcome.result.status).toBe('noop');
    expect(files.get('C:\\project\\src\\app.ts')).toBe('before');
    expect(repository.saveRestoreFileResult).toHaveBeenCalledWith(expect.objectContaining({
      status: 'noop',
      metadata: { alreadyRestored: true },
    }));
    expect(repository.saveRestoreFileResult).not.toHaveBeenCalledWith(expect.objectContaining({
      status: 'conflict',
    }));
    expect(repository.updateChangedFileRestoreState).toHaveBeenCalledWith(expect.objectContaining({
      restoreState: 'restored',
      metadata: expect.objectContaining({ alreadyRestored: true }),
    }));
  });

  it('treats a restorable modified file already at before content as noop', async () => {
    const files = new Map<string, string>([
      ['C:\\project\\src\\app.ts', 'before'],
    ]);
    const repository = fakeRepository({
      changedFiles: [changedFile({
        changeKind: 'modified',
        restoreState: 'restorable',
        beforeExists: true,
        beforeContentRefId: 'before-ref',
        beforeHash: sha256('before'),
        beforeByteLength: 6,
        afterExists: true,
        afterContentRefId: 'after-ref',
        afterHash: sha256('after'),
        afterByteLength: 5,
      })],
      snapshots: [
        snapshot('before-ref', 'before'),
        snapshot('after-ref', 'after'),
      ],
    });
    const service = createService({ files, repository });

    const outcome = await service.restoreChangeSet({
      changeSetId: 'change-set-1',
      requestedBy: 'user',
    });

    expect(outcome.result.status).toBe('noop');
    expect(files.get('C:\\project\\src\\app.ts')).toBe('before');
    expect(repository.saveRestoreFileResult).toHaveBeenCalledWith(expect.objectContaining({
      status: 'noop',
      metadata: { alreadyRestored: true },
    }));
    expect(repository.saveRestoreFileResult).not.toHaveBeenCalledWith(expect.objectContaining({
      status: 'conflict',
    }));
    expect(repository.updateChangedFileRestoreState).toHaveBeenCalledWith(expect.objectContaining({
      restoreState: 'restored',
      metadata: expect.objectContaining({ alreadyRestored: true }),
    }));
  });

  it('records conflict for a restorable deleted file when current file already exists', async () => {
    const files = new Map<string, string>([
      ['C:\\project\\src\\deleted.ts', 'old file'],
    ]);
    const repository = fakeRepository({
      changedFiles: [changedFile({
        projectPath: 'src/deleted.ts',
        changeKind: 'deleted',
        restoreState: 'restorable',
        beforeExists: true,
        beforeContentRefId: 'before-ref',
        beforeHash: sha256('old file'),
        beforeByteLength: 8,
        afterExists: false,
      })],
      snapshots: [snapshot('before-ref', 'old file', { projectPath: 'src/deleted.ts' })],
    });
    const service = createService({ files, repository });

    const outcome = await service.restoreChangeSet({
      changeSetId: 'change-set-1',
      requestedBy: 'user',
    });

    expect(outcome.result.status).toBe('conflict');
    expect(files.get('C:\\project\\src\\deleted.ts')).toBe('old file');
    expect(repository.saveRestoreFileResult).toHaveBeenCalledWith(expect.objectContaining({
      status: 'conflict',
      conflictReason: 'current_file_exists',
    }));
    expect(repository.updateChangedFileRestoreState).toHaveBeenCalledWith(expect.objectContaining({
      restoreState: 'conflict',
      metadata: expect.objectContaining({ conflictReason: 'current_file_exists' }),
    }));
  });

  it('does not restore or overwrite a not_restorable file', async () => {
    const files = new Map<string, string>([
      ['C:\\project\\src\\app.ts', 'after'],
    ]);
    const repository = fakeRepository({
      changedFiles: [changedFile({
        changeKind: 'modified',
        restoreState: 'not_restorable',
        beforeExists: true,
        beforeContentRefId: 'before-ref',
        beforeHash: sha256('before'),
        beforeByteLength: 6,
        afterExists: true,
        afterContentRefId: 'after-ref',
        afterHash: sha256('after'),
        afterByteLength: 5,
      })],
      snapshots: [
        snapshot('before-ref', 'before'),
        snapshot('after-ref', 'after'),
      ],
    });
    const service = createService({ files, repository });

    const outcome = await service.restoreChangeSet({
      changeSetId: 'change-set-1',
      requestedBy: 'user',
    });

    expect(outcome.result.status).toBe('noop');
    expect(files.get('C:\\project\\src\\app.ts')).toBe('after');
    expect(repository.saveRestoreFileResult).toHaveBeenCalledWith(expect.objectContaining({
      status: 'noop',
      metadata: { notRestorable: true },
    }));
    expect(repository.updateChangedFileRestoreState).not.toHaveBeenCalledWith(expect.objectContaining({
      restoreState: 'restored',
    }));
    expect(repository.updateChangedFileRestoreState).not.toHaveBeenCalledWith(expect.objectContaining({
      restoreState: 'conflict',
    }));
  });

  it('restores same-path changed files from final content back to original content', async () => {
    const files = new Map<string, string>([
      ['C:\\project\\src\\app.ts', 'C'],
    ]);
    const repository = fakeRepository({
      changedFiles: [
        changedFile({
          changedFileId: 'changed-file-a-to-b',
          projectPath: 'src/app.ts',
          changeKind: 'modified',
          beforeExists: true,
          beforeContentRefId: 'snapshot-a',
          beforeHash: sha256('A'),
          beforeByteLength: 1,
          afterExists: true,
          afterContentRefId: 'snapshot-b',
          afterHash: sha256('B'),
          afterByteLength: 1,
          createdAt: '2026-06-05T09:59:01.000Z',
        }),
        changedFile({
          changedFileId: 'changed-file-b-to-c',
          projectPath: 'src/app.ts',
          changeKind: 'modified',
          beforeExists: true,
          beforeContentRefId: 'snapshot-b',
          beforeHash: sha256('B'),
          beforeByteLength: 1,
          afterExists: true,
          afterContentRefId: 'snapshot-c',
          afterHash: sha256('C'),
          afterByteLength: 1,
          createdAt: '2026-06-05T09:59:02.000Z',
        }),
      ],
      snapshots: [
        snapshot('snapshot-a', 'A'),
        snapshot('snapshot-b', 'B'),
        snapshot('snapshot-c', 'C'),
      ],
    });
    const service = createService({ files, repository });

    const outcome = await service.restoreChangeSet({
      changeSetId: 'change-set-1',
      requestedBy: 'user',
    });

    expect(outcome.result.status).toBe('restored');
    expect(files.get('C:\\project\\src\\app.ts')).toBe('A');
    expect(repository.saveRestoreFileResult).toHaveBeenCalledWith(expect.objectContaining({
      changedFileId: 'changed-file-b-to-c',
      status: 'restored',
    }));
    expect(repository.saveRestoreFileResult).toHaveBeenCalledWith(expect.objectContaining({
      changedFileId: 'changed-file-a-to-b',
      status: 'restored',
    }));
    expect(repository.saveRestoreFileResult).not.toHaveBeenCalledWith(expect.objectContaining({
      status: 'conflict',
    }));
  });

  it('treats a same-path modified chain already at original content as noop', async () => {
    const files = new Map<string, string>([
      ['C:\\project\\src\\app.ts', 'A'],
    ]);
    const repository = fakeRepository({
      changedFiles: [
        changedFile({
          changedFileId: 'changed-file-a-to-b',
          projectPath: 'src/app.ts',
          changeKind: 'modified',
          beforeExists: true,
          beforeContentRefId: 'snapshot-a',
          beforeHash: sha256('A'),
          beforeByteLength: 1,
          afterExists: true,
          afterContentRefId: 'snapshot-b',
          afterHash: sha256('B'),
          afterByteLength: 1,
          createdAt: '2026-06-05T09:59:01.000Z',
        }),
        changedFile({
          changedFileId: 'changed-file-b-to-c',
          projectPath: 'src/app.ts',
          changeKind: 'modified',
          beforeExists: true,
          beforeContentRefId: 'snapshot-b',
          beforeHash: sha256('B'),
          beforeByteLength: 1,
          afterExists: true,
          afterContentRefId: 'snapshot-c',
          afterHash: sha256('C'),
          afterByteLength: 1,
          createdAt: '2026-06-05T09:59:02.000Z',
        }),
      ],
      snapshots: [
        snapshot('snapshot-a', 'A'),
        snapshot('snapshot-b', 'B'),
        snapshot('snapshot-c', 'C'),
      ],
    });
    const service = createService({ files, repository });

    const outcome = await service.restoreChangeSet({
      changeSetId: 'change-set-1',
      requestedBy: 'user',
    });

    expect(outcome.result.status).toBe('noop');
    expect(files.get('C:\\project\\src\\app.ts')).toBe('A');
    expect(repository.saveRestoreFileResult).toHaveBeenCalledWith(expect.objectContaining({
      changedFileId: 'changed-file-a-to-b',
      status: 'noop',
      metadata: { alreadyRestored: true },
    }));
    expect(repository.saveRestoreFileResult).toHaveBeenCalledWith(expect.objectContaining({
      changedFileId: 'changed-file-b-to-c',
      status: 'noop',
      metadata: { alreadyRestored: true },
    }));
    expect(repository.saveRestoreFileResult).not.toHaveBeenCalledWith(expect.objectContaining({
      status: 'conflict',
    }));
  });

  it('treats a same-path created then modified chain already absent as noop', async () => {
    const files = new Map<string, string>();
    const repository = fakeRepository({
      changedFiles: [
        changedFile({
          changedFileId: 'changed-file-created',
          projectPath: 'src/new.ts',
          changeKind: 'created',
          beforeExists: false,
          afterExists: true,
          afterContentRefId: 'snapshot-a',
          afterHash: sha256('A'),
          afterByteLength: 1,
          createdAt: '2026-06-05T09:59:01.000Z',
        }),
        changedFile({
          changedFileId: 'changed-file-a-to-b',
          projectPath: 'src/new.ts',
          changeKind: 'modified',
          beforeExists: true,
          beforeContentRefId: 'snapshot-a',
          beforeHash: sha256('A'),
          beforeByteLength: 1,
          afterExists: true,
          afterContentRefId: 'snapshot-b',
          afterHash: sha256('B'),
          afterByteLength: 1,
          createdAt: '2026-06-05T09:59:02.000Z',
        }),
      ],
      snapshots: [
        snapshot('snapshot-a', 'A', { projectPath: 'src/new.ts' }),
        snapshot('snapshot-b', 'B', { projectPath: 'src/new.ts' }),
      ],
    });
    const service = createService({ files, repository });

    const outcome = await service.restoreChangeSet({
      changeSetId: 'change-set-1',
      requestedBy: 'user',
    });

    expect(outcome.result.status).toBe('noop');
    expect(files.has('C:\\project\\src\\new.ts')).toBe(false);
    expect(repository.saveRestoreFileResult).toHaveBeenCalledWith(expect.objectContaining({
      changedFileId: 'changed-file-created',
      status: 'noop',
      metadata: { alreadyRestored: true },
    }));
    expect(repository.saveRestoreFileResult).toHaveBeenCalledWith(expect.objectContaining({
      changedFileId: 'changed-file-a-to-b',
      status: 'noop',
      metadata: { alreadyRestored: true },
    }));
    expect(repository.saveRestoreFileResult).not.toHaveBeenCalledWith(expect.objectContaining({
      status: 'conflict',
    }));
  });

  it('treats a same-path modified then deleted chain already at original content as noop', async () => {
    const files = new Map<string, string>([
      ['C:\\project\\src\\app.ts', 'A'],
    ]);
    const repository = fakeRepository({
      changedFiles: [
        changedFile({
          changedFileId: 'changed-file-a-to-b',
          projectPath: 'src/app.ts',
          changeKind: 'modified',
          beforeExists: true,
          beforeContentRefId: 'snapshot-a',
          beforeHash: sha256('A'),
          beforeByteLength: 1,
          afterExists: true,
          afterContentRefId: 'snapshot-b',
          afterHash: sha256('B'),
          afterByteLength: 1,
          createdAt: '2026-06-05T09:59:01.000Z',
        }),
        changedFile({
          changedFileId: 'changed-file-b-to-deleted',
          projectPath: 'src/app.ts',
          changeKind: 'deleted',
          beforeExists: true,
          beforeContentRefId: 'snapshot-b',
          beforeHash: sha256('B'),
          beforeByteLength: 1,
          afterExists: false,
          createdAt: '2026-06-05T09:59:02.000Z',
        }),
      ],
      snapshots: [
        snapshot('snapshot-a', 'A'),
        snapshot('snapshot-b', 'B'),
      ],
    });
    const service = createService({ files, repository });

    const outcome = await service.restoreChangeSet({
      changeSetId: 'change-set-1',
      requestedBy: 'user',
    });

    expect(outcome.result.status).toBe('noop');
    expect(files.get('C:\\project\\src\\app.ts')).toBe('A');
    expect(repository.saveRestoreFileResult).toHaveBeenCalledWith(expect.objectContaining({
      changedFileId: 'changed-file-a-to-b',
      status: 'noop',
      metadata: { alreadyRestored: true },
    }));
    expect(repository.saveRestoreFileResult).toHaveBeenCalledWith(expect.objectContaining({
      changedFileId: 'changed-file-b-to-deleted',
      status: 'noop',
      metadata: { alreadyRestored: true },
    }));
    expect(repository.saveRestoreFileResult).not.toHaveBeenCalledWith(expect.objectContaining({
      status: 'conflict',
    }));
  });

  it('treats mismatched before snapshot integrity as snapshot missing and does not overwrite', async () => {
    const files = new Map<string, string>([
      ['C:\\project\\src\\app.ts', 'after'],
    ]);
    const repository = fakeRepository({
      changedFiles: [changedFile({
        changeKind: 'modified',
        beforeExists: true,
        beforeContentRefId: 'before-ref',
        beforeHash: sha256('before'),
        beforeByteLength: 6,
        afterExists: true,
        afterContentRefId: 'after-ref',
        afterHash: sha256('after'),
        afterByteLength: 5,
      })],
      snapshots: [
        snapshot('before-ref', 'wrong before', {
          projectPath: 'src/other.ts',
          sha256: sha256('wrong before'),
          byteLength: 12,
        }),
        snapshot('after-ref', 'after'),
      ],
    });
    const service = createService({ files, repository });

    const outcome = await service.restoreChangeSet({
      changeSetId: 'change-set-1',
      requestedBy: 'user',
    });

    expect(outcome.result.status).toBe('conflict');
    expect(files.get('C:\\project\\src\\app.ts')).toBe('after');
    expect(repository.saveRestoreFileResult).toHaveBeenCalledWith(expect.objectContaining({
      status: 'conflict',
      conflictReason: 'snapshot_missing',
    }));
    expect(repository.updateChangedFileRestoreState).toHaveBeenCalledWith(expect.objectContaining({
      restoreState: 'conflict',
      metadata: expect.objectContaining({ conflictReason: 'snapshot_missing' }),
    }));
  });
});

function createService(input: {
  files: Map<string, string>;
  repository: WorkspaceRestoreRepositoryPort;
  fileSystem?: WorkspaceRestoreFileSystem;
}) {
  return new WorkspaceRestoreService({
    projectRoot: 'C:/project',
    repository: input.repository,
    fileSystem: input.fileSystem ?? fakeFileSystem(input.files),
    clock: fakeClock([
      '2026-06-05T10:00:00.000Z',
      '2026-06-05T10:00:01.000Z',
      '2026-06-05T10:00:02.000Z',
      '2026-06-05T10:00:03.000Z',
      '2026-06-05T10:00:04.000Z',
      '2026-06-05T10:00:05.000Z',
    ]),
    ids: {
      restoreRequestId: sequence('restore-request'),
      restoreResultId: sequence('restore-result'),
      restoreFileResultId: sequence('restore-file-result'),
    },
  });
}

function changeSet(overrides: Partial<WorkspaceChangeSet> = {}): WorkspaceChangeSet {
  return {
    changeSetId: 'change-set-1',
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: 'step-1',
    status: 'finalized',
    changedFileCount: 1,
    createdAt: '2026-06-05T09:59:00.000Z',
    finalizedAt: '2026-06-05T09:59:01.000Z',
    ...overrides,
  };
}

function changedFile(overrides: Partial<WorkspaceChangedFile> = {}): WorkspaceChangedFile {
  return {
    changedFileId: 'changed-file-1',
    changeSetId: 'change-set-1',
    workspaceCheckpointId: 'checkpoint-1',
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: 'step-1',
    projectPath: 'src/app.ts',
    changeKind: 'modified',
    restoreState: 'restorable',
    beforeExists: true,
    beforeContentRefId: 'before-ref',
    beforeHash: sha256('before'),
    beforeByteLength: 6,
    afterExists: true,
    afterContentRefId: 'after-ref',
    afterHash: sha256('after'),
    afterByteLength: 5,
    createdAt: '2026-06-05T09:59:02.000Z',
    updatedAt: '2026-06-05T09:59:02.000Z',
    ...overrides,
  };
}

function snapshot(
  contentRefId: string,
  contentText: string,
  overrides: Partial<WorkspaceSnapshotContent> = {},
): WorkspaceSnapshotContent {
  return {
    contentRefId,
    sessionId: 'session-1',
    runId: 'run-1',
    projectPath: 'src/app.ts',
    storage: 'sqlite_text',
    encoding: 'utf8',
    sha256: sha256(contentText),
    byteLength: Buffer.byteLength(contentText, 'utf8'),
    contentText,
    createdAt: '2026-06-05T09:59:00.000Z',
    ...overrides,
  };
}

function fakeRepository(input: {
  changedFiles?: WorkspaceChangedFile[];
  snapshots?: WorkspaceSnapshotContent[];
  changeSet?: WorkspaceChangeSet;
  summary?: WorkspaceChangeSummary;
} = {}) {
  const restoreRequests = new Map<string, WorkspaceRestoreRequest>();
  const snapshots = new Map((input.snapshots ?? []).map((content) => [content.contentRefId, content]));
  const changeSetRecord = input.changeSet ?? changeSet({
    changedFileCount: input.changedFiles?.length ?? 0,
  });
  const summary = input.summary ?? {
    changeSetId: changeSetRecord.changeSetId,
    sessionId: changeSetRecord.sessionId,
    runId: changeSetRecord.runId,
    changedFileCount: input.changedFiles?.length ?? 0,
    restorableCount: input.changedFiles?.length ?? 0,
    restoredCount: 0,
    conflictCount: 0,
    failedCount: 0,
    hasRestorableChanges: Boolean(input.changedFiles?.length),
    updatedAt: '2026-06-05T09:59:02.000Z',
  };
  const repository = {
    getChangeSet: vi.fn((changeSetId: string) => (
      changeSetId === changeSetRecord.changeSetId ? changeSetRecord : undefined
    )),
    listChangedFilesByChangeSet: vi.fn((changeSetId: string) => (
      changeSetId === changeSetRecord.changeSetId ? [...(input.changedFiles ?? [])] : []
    )),
    getSnapshotContent: vi.fn((contentRefId: string) => snapshots.get(contentRefId)),
    saveRestoreRequest: vi.fn((request: WorkspaceRestoreRequest) => {
      restoreRequests.set(request.restoreRequestId, request);
      return request;
    }),
    updateRestoreRequestStatus: vi.fn((update: {
      restoreRequestId: string;
      status: WorkspaceRestoreRequest['status'];
      completedAt?: string;
      metadata?: WorkspaceRestoreRequest['metadata'];
    }) => {
      const existing = restoreRequests.get(update.restoreRequestId);
      if (!existing) return undefined;
      const next = { ...existing, ...update };
      restoreRequests.set(update.restoreRequestId, next);
      return next;
    }),
    saveRestoreResult: vi.fn((result: WorkspaceRestoreResult) => result),
    saveRestoreFileResult: vi.fn((fileResult: WorkspaceRestoreFileResult) => fileResult),
    updateChangedFileRestoreState: vi.fn((update: {
      changedFileId: string;
      restoreState: WorkspaceChangedFile['restoreState'];
      updatedAt: string;
      metadata?: WorkspaceChangedFile['metadata'];
    }) => {
      const existing = input.changedFiles?.find((file) => file.changedFileId === update.changedFileId);
      return existing ? { ...existing, ...update } : undefined;
    }),
    getChangeSummary: vi.fn((changeSetId: string) => (
      changeSetId === changeSetRecord.changeSetId ? summary : undefined
    )),
  } satisfies WorkspaceRestoreRepositoryPort;
  return repository;
}

function fakeFileSystem(
  files: Map<string, string>,
  options: {
    nonFiles?: Set<string>;
    failPathExists?: Set<string>;
    failStats?: Set<string>;
    failReads?: Set<string>;
    failWrites?: Set<string>;
    failRemoves?: Set<string>;
  } = {},
): WorkspaceRestoreFileSystem {
  return {
    async pathExists(filePath: string) {
      if (options.failPathExists?.has(filePath)) {
        throw new Error(`pathExists failed: ${filePath}`);
      }
      return files.has(filePath) || Boolean(options.nonFiles?.has(filePath));
    },
    async stat(filePath: string) {
      if (options.failStats?.has(filePath)) {
        throw new Error(`stat failed: ${filePath}`);
      }
      if (!files.has(filePath) && !options.nonFiles?.has(filePath)) {
        throw new Error(`missing path: ${filePath}`);
      }
      return {
        isFile: () => files.has(filePath) && !options.nonFiles?.has(filePath),
      };
    },
    async readFile(filePath: string) {
      if (options.failReads?.has(filePath)) {
        throw new Error(`read failed: ${filePath}`);
      }
      const content = files.get(filePath);
      if (content === undefined) {
        throw new Error(`missing file: ${filePath}`);
      }
      return content;
    },
    async writeFile(filePath: string, content: string) {
      if (options.failWrites?.has(filePath)) {
        throw new Error(`write failed: ${filePath}`);
      }
      files.set(filePath, content);
    },
    async mkdir() {
      return undefined;
    },
    async remove(filePath: string) {
      if (options.failRemoves?.has(filePath)) {
        throw new Error(`remove failed: ${filePath}`);
      }
      files.delete(filePath);
    },
  };
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function sequence(prefix: string) {
  let index = 0;
  return () => `${prefix}-${++index}`;
}

function fakeClock(values: string[]) {
  let index = 0;
  return {
    now() {
      return values[Math.min(index++, values.length - 1)];
    },
  };
}


