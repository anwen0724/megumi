import { describe, expect, it, vi } from 'vitest';

import type {
  WorkspaceChangedFile,
  WorkspaceChangeSet,
} from '@megumi/coding-agent/workspace';
import { createWorkspacePathPolicyService } from '@megumi/coding-agent/workspace/services/workspace-path-policy-service';
import { createWorkspaceChangeService } from '@megumi/coding-agent/workspace/services/workspace-change-service';

describe('WorkspaceChangeService', () => {
  it('executes read-only and unmanaged tools without recording changes', async () => {
    const repository = fakeRepository();
    const service = createService({ repository });
    const read = vi.fn(async () => 'read');
    const run = vi.fn(async () => 'ran');

    await expect(service.trackToolExecution({
      scope: scope(),
      tool_execution: toolExecution('read_file', { path: 'README.md' }),
      execute: read,
    })).resolves.toBe('read');
    await expect(service.trackToolExecution({
      scope: scope(),
      tool_execution: toolExecution('run_command', { command: 'node -v' }),
      execute: run,
    })).resolves.toBe('ran');

    expect(repository.changeSets).toEqual([]);
    expect(repository.files).toEqual([]);
  });

  it('records successful write, edit, and delete mutations', async () => {
    const files = new Map<string, boolean>();
    const repository = fakeRepository();
    const service = createService({ files, repository });

    await service.trackToolExecution({
      scope: scope(),
      tool_execution: toolExecution('write_file', { path: 'src/new.ts' }),
      execute: async () => {
        files.set('C:\\project\\src\\new.ts', true);
        return 'created';
      },
    });
    files.set('C:\\project\\src\\app.ts', true);
    await service.trackToolExecution({
      scope: scope(),
      tool_execution: toolExecution('edit_file', { path: 'src/app.ts' }),
      execute: async () => 'modified',
    });
    files.set('C:\\project\\src\\old.ts', true);
    await service.trackToolExecution({
      scope: scope(),
      tool_execution: toolExecution('delete_file', { path: 'src/old.ts' }),
      execute: async () => {
        files.set('C:\\project\\src\\old.ts', false);
        return 'deleted';
      },
    });

    expect(repository.files.map((file) => [file.workspace_path, file.change_kind])).toEqual([
      ['src/new.ts', 'created'],
      ['src/app.ts', 'modified'],
      ['src/old.ts', 'deleted'],
    ]);
    expect(repository.changeSets).toHaveLength(1);
  });

  it('records nothing when tool execution fails', async () => {
    const files = new Map<string, boolean>();
    const repository = fakeRepository();
    const service = createService({ files, repository });

    await expect(service.trackToolExecution({
      scope: scope(),
      tool_execution: toolExecution('write_file', { path: 'src/new.ts' }),
      execute: async () => {
        throw new Error('write failed');
      },
    })).rejects.toThrow('write failed');

    expect(repository.changeSets).toEqual([]);
    expect(repository.files).toEqual([]);
  });

  it('keeps one changed file per change set path and updates the change kind', async () => {
    const files = new Map<string, boolean>();
    const repository = fakeRepository();
    const service = createService({ files, repository });

    await service.trackToolExecution({
      scope: scope(),
      tool_execution: toolExecution('write_file', { path: 'src/app.ts' }),
      execute: async () => {
        files.set('C:\\project\\src\\app.ts', true);
      },
    });
    await service.trackToolExecution({
      scope: scope(),
      tool_execution: toolExecution('edit_file', { path: 'src/app.ts' }),
      execute: async () => undefined,
    });

    expect(repository.files).toEqual([
      expect.objectContaining({
        changed_file_id: 'changed-file:1',
        workspace_path: 'src/app.ts',
        change_kind: 'modified',
      }),
    ]);
  });

  it('finalizes and exposes summaries and changed files', async () => {
    const files = new Map<string, boolean>();
    const repository = fakeRepository();
    const service = createService({ files, repository });

    await service.trackToolExecution({
      scope: scope(),
      tool_execution: toolExecution('write_file', { path: 'src/new.ts' }),
      execute: async () => {
        files.set('C:\\project\\src\\new.ts', true);
      },
    });
    expect(service.finalizeChangeSet({
      workspace_id: 'workspace:one',
      session_id: 'session:one',
      run_id: 'run:one',
      finalized_at: '2026-05-16T00:01:00.000Z',
    })).toEqual({
      status: 'finalized',
      change_set: expect.objectContaining({
        status: 'finalized',
        changed_file_count: 1,
      }),
    });

    expect(service.getChangeSummary({ change_set_id: 'change-set:1' })).toEqual({
      status: 'found',
      summary: {
        change_set: expect.objectContaining({ change_set_id: 'change-set:1' }),
        files: [expect.objectContaining({ workspace_path: 'src/new.ts' })],
      },
    });
    expect(service.listChangedFiles({ by: 'change_set', change_set_id: 'change-set:1' }).files).toHaveLength(1);
    expect(service.listChangedFiles({ by: 'run', run_id: 'run:one' }).files).toHaveLength(1);
  });

  it('executes but skips recording after a finalized change set for the same run scope', async () => {
    const files = new Map<string, boolean>();
    const repository = fakeRepository();
    const service = createService({ files, repository });

    await service.trackToolExecution({
      scope: scope(),
      tool_execution: toolExecution('write_file', { path: 'src/first.ts' }),
      execute: async () => {
        files.set('C:\\project\\src\\first.ts', true);
      },
    });
    service.finalizeChangeSet({
      workspace_id: 'workspace:one',
      session_id: 'session:one',
      run_id: 'run:one',
      finalized_at: '2026-05-16T00:01:00.000Z',
    });
    const execute = vi.fn(async () => {
      files.set('C:\\project\\src\\second.ts', true);
      return 'ran';
    });

    await expect(service.trackToolExecution({
      scope: scope(),
      tool_execution: toolExecution('write_file', { path: 'src/second.ts' }),
      execute,
    })).resolves.toBe('ran');

    expect(execute).toHaveBeenCalledTimes(1);
    expect(repository.files.map((file) => file.workspace_path)).toEqual(['src/first.ts']);
  });

  it('returns not_found when no open change set exists', () => {
    const service = createService({ repository: fakeRepository() });

    expect(service.finalizeChangeSet({
      workspace_id: 'workspace:one',
      session_id: 'session:one',
      run_id: 'run:one',
      finalized_at: '2026-05-16T00:01:00.000Z',
    })).toEqual({ status: 'not_found' });
  });
});

function createService(options: {
  files?: Map<string, boolean>;
  repository: FakeWorkspaceChangeRepository;
}) {
  const files = options.files ?? new Map<string, boolean>();
  let changeSetId = 0;
  let changedFileId = 0;
  return createWorkspaceChangeService({
    repository: options.repository,
    path_policy: createWorkspacePathPolicyService(),
    file_system: {
      exists: async (path) => files.get(path) === true,
    },
    ids: {
      change_set_id: () => `change-set:${++changeSetId}`,
      changed_file_id: () => `changed-file:${++changedFileId}`,
    },
    now: () => '2026-05-16T00:00:00.000Z',
  });
}

function scope() {
  return {
    workspace_id: 'workspace:one',
    session_id: 'session:one',
    run_id: 'run:one',
  };
}

function toolExecution(tool_name: string, input: unknown) {
  return {
    tool_name,
    input,
    workspace_root: 'C:/project',
  };
}

interface FakeWorkspaceChangeRepository {
  changeSets: WorkspaceChangeSet[];
  files: WorkspaceChangedFile[];
  insertChangeSet(change_set: WorkspaceChangeSet): WorkspaceChangeSet;
  findOpenChangeSet(input: { workspace_id: string; session_id: string; run_id: string }): WorkspaceChangeSet | undefined;
  listChangeSetsByRunId(run_id: string): WorkspaceChangeSet[];
  finalizeChangeSet(input: { change_set_id: string; finalized_at: string }): WorkspaceChangeSet | undefined;
  insertOrUpdateChangedFile(file: WorkspaceChangedFile): WorkspaceChangedFile;
  listChangedFilesByChangeSetId(change_set_id: string): WorkspaceChangedFile[];
  listChangedFilesByRunId(run_id: string): WorkspaceChangedFile[];
  getChangeSummary(change_set_id: string): { change_set: WorkspaceChangeSet; files: WorkspaceChangedFile[] } | undefined;
}

function fakeRepository(): FakeWorkspaceChangeRepository {
  const repository: FakeWorkspaceChangeRepository = {
    changeSets: [],
    files: [],
    insertChangeSet(change_set) {
      repository.changeSets.push(change_set);
      return change_set;
    },
    findOpenChangeSet(input) {
      return repository.changeSets.find((change_set) => change_set.workspace_id === input.workspace_id
        && change_set.session_id === input.session_id
        && change_set.run_id === input.run_id
        && change_set.status === 'open');
    },
    listChangeSetsByRunId(run_id) {
      return repository.changeSets.filter((change_set) => change_set.run_id === run_id);
    },
    finalizeChangeSet(input) {
      const changeSet = repository.changeSets.find((item) => item.change_set_id === input.change_set_id);
      if (!changeSet) {
        return undefined;
      }
      changeSet.status = 'finalized';
      changeSet.finalized_at = input.finalized_at;
      changeSet.changed_file_count = repository.files.filter((file) => file.change_set_id === input.change_set_id).length;
      return changeSet;
    },
    insertOrUpdateChangedFile(file) {
      const existing = repository.files.find((item) => item.change_set_id === file.change_set_id
        && item.workspace_path === file.workspace_path);
      if (existing) {
        existing.change_kind = file.change_kind;
        return existing;
      }
      repository.files.push(file);
      return file;
    },
    listChangedFilesByChangeSetId(change_set_id) {
      return repository.files.filter((file) => file.change_set_id === change_set_id);
    },
    listChangedFilesByRunId(run_id) {
      const changeSetIds = new Set(repository.changeSets
        .filter((change_set) => change_set.run_id === run_id)
        .map((change_set) => change_set.change_set_id));
      return repository.files.filter((file) => changeSetIds.has(file.change_set_id));
    },
    getChangeSummary(change_set_id) {
      const change_set = repository.changeSets.find((item) => item.change_set_id === change_set_id);
      return change_set
        ? { change_set, files: repository.listChangedFilesByChangeSetId(change_set_id) }
        : undefined;
    },
  };
  return repository;
}
