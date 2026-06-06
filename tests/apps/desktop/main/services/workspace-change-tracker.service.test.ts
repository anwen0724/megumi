// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { ToolExecution } from '@megumi/shared/tool-contracts';
import type {
  WorkspaceChangedFile,
  WorkspaceChangeSet,
  WorkspaceCheckpoint,
  WorkspaceSnapshotContent,
} from '@megumi/shared/workspace-change-contracts';
import {
  WorkspaceChangeTrackerService,
  type WorkspaceChangeTrackerRepositoryPort,
} from '@megumi/desktop/main/services/workspace-change-tracker.service';

describe('WorkspaceChangeTrackerService', () => {
  it('records a created file mutation around a successful write_file execution', async () => {
    const files = new Map<string, string>();
    const repository = fakeRepository();
    const tracker = createTracker({ files, repository });

    const result = await tracker.trackToolExecution({
      scope: scope(),
      toolExecution: toolExecution('write_file', { path: 'src/new.ts', content: 'export {}' }),
      execute: async () => {
        files.set('C:\\project\\src\\new.ts', 'export {}');
        return 'ok';
      },
    });
    const finalized = tracker.finalizeChangeSet(scope());

    expect(result).toBe('ok');
    expect(repository.saveChangeSet).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      status: 'open',
      changedFileCount: 0,
    }));
    expect(repository.saveWorkspaceCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
      projectPath: 'src/new.ts',
      beforeExists: false,
      beforeContentRefId: undefined,
    }));
    expect(repository.saveChangedFile).toHaveBeenCalledWith(expect.objectContaining({
      projectPath: 'src/new.ts',
      changeKind: 'created',
      restoreState: 'restorable',
      beforeExists: false,
      afterExists: true,
      afterHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      afterByteLength: 9,
    }));
    expect(repository.saveWorkspaceCheckpoint.mock.invocationCallOrder[0])
      .toBeLessThan(repository.saveChangedFile.mock.invocationCallOrder[0]);
    expect(finalized).toMatchObject({
      status: 'finalized',
      changedFileCount: 1,
    });
  });

  it('records a modified file mutation with before and after snapshots', async () => {
    const files = new Map<string, string>([
      ['C:\\project\\src\\app.ts', 'before'],
    ]);
    const repository = fakeRepository();
    const tracker = createTracker({ files, repository });

    await tracker.trackToolExecution({
      scope: scope(),
      toolExecution: toolExecution('edit_file', {
        path: 'src/app.ts',
        oldText: 'before',
        newText: 'after',
      }),
      execute: async () => {
        files.set('C:\\project\\src\\app.ts', 'after');
        return 'edited';
      },
    });

    expect(repository.saveSnapshotContent).toHaveBeenCalledWith(expect.objectContaining({
      contentRefId: 'snapshot-1',
      projectPath: 'src/app.ts',
      contentText: 'before',
      byteLength: 6,
    }));
    expect(repository.saveSnapshotContent).toHaveBeenCalledWith(expect.objectContaining({
      contentRefId: 'snapshot-2',
      projectPath: 'src/app.ts',
      contentText: 'after',
      byteLength: 5,
    }));
    expect(repository.saveWorkspaceCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
      projectPath: 'src/app.ts',
      beforeExists: true,
      beforeContentRefId: 'snapshot-1',
      beforeByteLength: 6,
    }));
    expect(repository.saveChangedFile).toHaveBeenCalledWith(expect.objectContaining({
      projectPath: 'src/app.ts',
      changeKind: 'modified',
      beforeExists: true,
      beforeContentRefId: 'snapshot-1',
      beforeByteLength: 6,
      afterExists: true,
      afterContentRefId: 'snapshot-2',
      afterByteLength: 5,
    }));
  });

  it('does not execute the write when before snapshot persistence fails', async () => {
    const files = new Map<string, string>([
      ['C:\\project\\src\\app.ts', 'before'],
    ]);
    const repository = fakeRepository({
      saveSnapshotContent: vi.fn(() => {
        throw new Error('snapshot failed');
      }),
    });
    const tracker = createTracker({ files, repository });
    const execute = vi.fn(async () => {
      files.set('C:\\project\\src\\app.ts', 'after');
      return 'edited';
    });

    await expect(tracker.trackToolExecution({
      scope: scope(),
      toolExecution: toolExecution('edit_file', {
        path: 'src/app.ts',
        oldText: 'before',
        newText: 'after',
      }),
      execute,
    })).rejects.toThrow('snapshot failed');

    expect(execute).not.toHaveBeenCalled();
    expect(files.get('C:\\project\\src\\app.ts')).toBe('before');
    expect(repository.saveWorkspaceCheckpoint).not.toHaveBeenCalled();
    expect(repository.saveChangedFile).not.toHaveBeenCalled();
  });

  it('fails closed before writing unsupported snapshot text', async () => {
    const files = new Map<string, string>([
      ['C:\\project\\src\\binary.dat', 'before\u0000content'],
    ]);
    const repository = fakeRepository();
    const tracker = createTracker({ files, repository });
    const execute = vi.fn(async () => {
      files.set('C:\\project\\src\\binary.dat', 'after');
      return 'written';
    });

    await expect(tracker.trackToolExecution({
      scope: scope(),
      toolExecution: toolExecution('write_file', {
        path: 'src/binary.dat',
        content: 'after',
      }),
      execute,
    })).rejects.toThrow('unsupported text content');

    expect(execute).not.toHaveBeenCalled();
    expect(files.get('C:\\project\\src\\binary.dat')).toBe('before\u0000content');
    expect(repository.saveSnapshotContent).not.toHaveBeenCalled();
    expect(repository.saveWorkspaceCheckpoint).not.toHaveBeenCalled();
    expect(repository.saveChangedFile).not.toHaveBeenCalled();
  });

  it('fails closed before checkpointing projected unsupported after text', async () => {
    const files = new Map<string, string>([
      ['C:\\project\\src\\app.ts', 'before'],
    ]);
    const repository = fakeRepository();
    const tracker = createTracker({ files, repository });
    const execute = vi.fn(async () => {
      files.set('C:\\project\\src\\app.ts', 'after\u0000content');
      return 'written';
    });

    await expect(tracker.trackToolExecution({
      scope: scope(),
      toolExecution: toolExecution('write_file', {
        path: 'src/app.ts',
        content: 'after\u0000content',
      }),
      execute,
    })).rejects.toThrow('unsupported text content');

    expect(execute).not.toHaveBeenCalled();
    expect(files.get('C:\\project\\src\\app.ts')).toBe('before');
    expect(repository.saveWorkspaceCheckpoint).not.toHaveBeenCalled();
    expect(repository.saveChangedFile).not.toHaveBeenCalled();
  });

  it('does not create a changed file when execution fails after checkpointing', async () => {
    const files = new Map<string, string>([
      ['C:\\project\\src\\app.ts', 'before'],
    ]);
    const repository = fakeRepository();
    const tracker = createTracker({ files, repository });
    const execute = vi.fn(async () => {
      throw new Error('write failed before mutation');
    });

    await expect(tracker.trackToolExecution({
      scope: scope(),
      toolExecution: toolExecution('edit_file', {
        path: 'src/app.ts',
        oldText: 'missing',
        newText: 'after',
      }),
      execute,
    })).rejects.toThrow('write failed before mutation');

    expect(execute).toHaveBeenCalledTimes(1);
    expect(files.get('C:\\project\\src\\app.ts')).toBe('before');
    expect(repository.saveWorkspaceCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
      projectPath: 'src/app.ts',
      beforeExists: true,
    }));
    expect(repository.saveChangedFile).not.toHaveBeenCalled();
  });

  it('does not record a changed file for a no-op overwrite', async () => {
    const files = new Map<string, string>([
      ['C:\\project\\src\\app.ts', 'same'],
    ]);
    const repository = fakeRepository();
    const tracker = createTracker({ files, repository });

    const result = await tracker.trackToolExecution({
      scope: scope(),
      toolExecution: toolExecution('write_file', { path: 'src/app.ts', content: 'same' }),
      execute: async () => {
        files.set('C:\\project\\src\\app.ts', 'same');
        return 'ok';
      },
    });
    const finalized = tracker.finalizeChangeSet(scope());

    expect(result).toBe('ok');
    expect(repository.saveWorkspaceCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
      projectPath: 'src/app.ts',
      beforeExists: true,
    }));
    expect(repository.saveChangedFile).not.toHaveBeenCalled();
    expect(finalized).toMatchObject({
      status: 'finalized',
      changedFileCount: 0,
    });
  });

  it('skips non-managed tools and has nothing to finalize', async () => {
    const repository = fakeRepository();
    const tracker = createTracker({ files: new Map(), repository });
    const execute = vi.fn(async () => 'ran');

    await expect(tracker.trackToolExecution({
      scope: scope(),
      toolExecution: toolExecution('run_command', { command: 'node -v' }),
      execute,
    })).resolves.toBe('ran');

    expect(execute).toHaveBeenCalledTimes(1);
    expect(repository.saveChangeSet).not.toHaveBeenCalled();
    expect(repository.saveWorkspaceCheckpoint).not.toHaveBeenCalled();
    expect(repository.saveChangedFile).not.toHaveBeenCalled();
    expect(tracker.finalizeChangeSet(scope())).toBeUndefined();
  });

  it('skips project read tools because they are not managed mutations', async () => {
    const repository = fakeRepository();
    const tracker = createTracker({ files: new Map(), repository });
    const execute = vi.fn(async () => 'read');

    await expect(tracker.trackToolExecution({
      scope: scope(),
      toolExecution: toolExecution('read_file', { path: 'README.md' }),
      execute,
    })).resolves.toBe('read');

    expect(execute).toHaveBeenCalledTimes(1);
    expect(repository.saveChangeSet).not.toHaveBeenCalled();
    expect(repository.saveWorkspaceCheckpoint).not.toHaveBeenCalled();
    expect(repository.saveChangedFile).not.toHaveBeenCalled();
    expect(tracker.finalizeChangeSet(scope())).toBeUndefined();
  });

  it('serializes managed mutations for the same file path', async () => {
    const files = new Map<string, string>([
      ['C:\\project\\src\\app.ts', 'one'],
    ]);
    const repository = fakeRepository();
    const tracker = createTracker({ files, repository });
    const firstRelease = createDeferred<void>();

    const first = tracker.trackToolExecution({
      scope: scope(),
      toolExecution: toolExecution('write_file', { path: 'src/app.ts', content: 'two' }, 'tool-execution-1'),
      execute: async () => {
        await firstRelease.promise;
        files.set('C:\\project\\src\\app.ts', 'two');
      },
    });
    const second = tracker.trackToolExecution({
      scope: scope(),
      toolExecution: toolExecution('write_file', { path: 'src/app.ts', content: 'three' }, 'tool-execution-2'),
      execute: async () => {
        files.set('C:\\project\\src\\app.ts', 'three');
      },
    });

    firstRelease.resolve();
    await Promise.all([first, second]);

    const savedSnapshots = repository.saveSnapshotContent.mock.calls
      .map(([snapshot]) => snapshot.contentText);
    expect(savedSnapshots).toEqual(['one', 'two', 'two', 'three']);
  });
});

function createTracker(input: {
  files: Map<string, string>;
  repository: WorkspaceChangeTrackerRepositoryPort;
}) {
  return new WorkspaceChangeTrackerService({
    projectRoot: 'C:/project',
    fileSystem: fakeFileSystem(input.files),
    repository: input.repository,
    now: fakeClock([
      '2026-06-05T10:00:00.000Z',
      '2026-06-05T10:00:01.000Z',
      '2026-06-05T10:00:02.000Z',
      '2026-06-05T10:00:03.000Z',
      '2026-06-05T10:00:04.000Z',
      '2026-06-05T10:00:05.000Z',
    ]),
    ids: {
      changeSetId: sequence('change-set'),
      workspaceCheckpointId: sequence('checkpoint'),
      snapshotContentRefId: sequence('snapshot'),
      changedFileId: sequence('changed-file'),
    },
  });
}

function scope() {
  return {
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: 'step-1',
  };
}

function toolExecution(
  toolName: string,
  input: Record<string, unknown>,
  toolExecutionId = 'tool-execution-1',
): ToolExecution {
  return {
    toolExecutionId,
    toolCallId: `tool-call-${toolExecutionId}`,
    runId: 'run-1',
    stepId: 'step-1',
    toolName,
    input: input as ToolExecution['input'],
    inputPreview: {
      summary: toolName,
      targets: [],
      redactionState: 'none',
    },
    capabilities: toolName === 'run_command' ? ['command_run'] : ['project_write'],
    riskLevel: 'low',
    sideEffect: toolName === 'run_command' ? 'execute_command' : 'project_file_operation',
    status: 'running',
    requestedAt: '2026-06-05T09:59:00.000Z',
  };
}

function fakeRepository(overrides: Partial<WorkspaceChangeTrackerRepositoryPort> = {}) {
  const changeSets = new Map<string, WorkspaceChangeSet>();
  const changedFilesByChangeSet = new Map<string, WorkspaceChangedFile[]>();
  const repository: WorkspaceChangeTrackerRepositoryPort = {
    getChangeSet: vi.fn((changeSetId: string) => changeSets.get(changeSetId)),
    saveChangeSet: vi.fn((changeSet: WorkspaceChangeSet) => {
      changeSets.set(changeSet.changeSetId, changeSet);
      return changeSet;
    }),
    finalizeChangeSet: vi.fn((changeSetId: string, finalizedAt: string) => {
      const existing = changeSets.get(changeSetId);
      if (!existing) return undefined;
      const changedFiles = changedFilesByChangeSet.get(changeSetId) ?? [];
      const finalized = {
        ...existing,
        status: 'finalized' as const,
        finalizedAt,
        changedFileCount: changedFiles.length,
      };
      changeSets.set(changeSetId, finalized);
      return finalized;
    }),
    saveSnapshotContent: vi.fn((snapshot: WorkspaceSnapshotContent) => snapshot),
    saveWorkspaceCheckpoint: vi.fn((checkpoint: WorkspaceCheckpoint) => checkpoint),
    saveChangedFile: vi.fn((changedFile: WorkspaceChangedFile) => {
      const current = changedFilesByChangeSet.get(changedFile.changeSetId) ?? [];
      current.push(changedFile);
      changedFilesByChangeSet.set(changedFile.changeSetId, current);
      return changedFile;
    }),
    ...overrides,
  };
  return repository as WorkspaceChangeTrackerRepositoryPort & {
    getChangeSet: ReturnType<typeof vi.fn>;
    saveChangeSet: ReturnType<typeof vi.fn>;
    finalizeChangeSet: ReturnType<typeof vi.fn>;
    saveSnapshotContent: ReturnType<typeof vi.fn>;
    saveWorkspaceCheckpoint: ReturnType<typeof vi.fn>;
    saveChangedFile: ReturnType<typeof vi.fn>;
  };
}

function fakeFileSystem(files: Map<string, string>) {
  return {
    async readFile(filePath: string) {
      const value = files.get(filePath);
      if (value === undefined) throw missingFileError(filePath);
      return value;
    },
    async stat(filePath: string) {
      if (files.has(filePath)) {
        return {
          isFile: () => true,
          isDirectory: () => false,
          size: Buffer.byteLength(files.get(filePath) ?? '', 'utf8'),
        };
      }
      throw missingFileError(filePath);
    },
  };
}

function missingFileError(filePath: string): NodeJS.ErrnoException {
  const error = new Error(`Missing path: ${filePath}`) as NodeJS.ErrnoException;
  error.code = 'ENOENT';
  return error;
}

function sequence(prefix: string) {
  let index = 0;
  return () => `${prefix}-${++index}`;
}

function fakeClock(values: string[]) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}
