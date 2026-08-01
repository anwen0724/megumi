/*
 * Protects fingerprint-based successful mutation tracking and projection isolation.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createWorkspaceChanges,
  createWorkspacePathPolicy,
  type WorkspaceChangedFile,
  type WorkspaceChangeSet,
  type WorkspaceChangeSummary,
  type WorkspaceFileFingerprint,
  type WorkspaceStore,
} from '../../../packages/workspace/src/index';

type Result = { type: 'succeeded' | 'failed' | 'cancelled'; value?: string };
const succeeded = (value = 'ok'): Result => ({ type: 'succeeded', value });
const isSuccessful = (result: Result) => result.type === 'succeeded';

describe('WorkspaceChanges', () => {
  it('records created and genuinely modified files in one open change set', async () => {
    const fingerprints = new Map<string, WorkspaceFileFingerprint>();
    const store = fakeStore();
    const changes = createChanges({ store, fingerprints });

    await changes.trackToolExecution({
      scope: scope(),
      tool_execution: toolExecution('write_file', { path: 'src/new.ts' }),
      is_successful_outcome: isSuccessful,
      execute: async () => {
        fingerprints.set('/workspace/src/new.ts', fingerprint('new'));
        return succeeded('created');
      },
    });
    fingerprints.set('/workspace/src/app.ts', fingerprint('before'));
    await changes.trackToolExecution({
      scope: scope(),
      tool_execution: toolExecution('edit_file', { path: 'src/app.ts' }),
      is_successful_outcome: isSuccessful,
      execute: async () => {
        fingerprints.set('/workspace/src/app.ts', fingerprint('after'));
        return succeeded('modified');
      },
    });

    expect(store.files.map((file) => [file.workspace_path, file.change_kind])).toEqual([
      ['src/new.ts', 'created'],
      ['src/app.ts', 'modified'],
    ]);
    expect(store.changeSets).toHaveLength(1);
  });

  it('does not record a no-op write with an unchanged fingerprint', async () => {
    const fingerprints = new Map([['/workspace/src/app.ts', fingerprint('same')]]);
    const store = fakeStore();
    const result = await createChanges({ store, fingerprints }).trackToolExecution({
      scope: scope(),
      tool_execution: toolExecution('write_file', { path: 'src/app.ts' }),
      is_successful_outcome: isSuccessful,
      execute: async () => {
        fingerprints.set('/workspace/src/app.ts', fingerprint('same', 200));
        return succeeded();
      },
    });

    expect(result).toEqual(succeeded());
    expect(store.changeSets).toEqual([]);
    expect(store.files).toEqual([]);
  });

  it.each(['failed', 'cancelled'] as const)(
    'does not record a structured %s result even when the file changed',
    async (type) => {
      const fingerprints = new Map([['/workspace/src/app.ts', fingerprint('before')]]);
      const store = fakeStore();
      await createChanges({ store, fingerprints }).trackToolExecution({
        scope: scope(),
        tool_execution: toolExecution('edit_file', { path: 'src/app.ts' }),
        is_successful_outcome: isSuccessful,
        execute: async () => {
          fingerprints.set('/workspace/src/app.ts', fingerprint('after'));
          return { type };
        },
      });
      expect(store.files).toEqual([]);
      expect(store.changeSets).toEqual([]);
    },
  );

  it('propagates Tool exceptions without recording a change', async () => {
    const store = fakeStore();
    const changes = createChanges({ store, fingerprints: new Map() });
    await expect(changes.trackToolExecution({
      scope: scope(),
      tool_execution: toolExecution('write_file', { path: 'src/new.ts' }),
      is_successful_outcome: isSuccessful,
      execute: async () => { throw new Error('write failed'); },
    })).rejects.toThrow('write failed');
    expect(store.files).toEqual([]);
  });

  it('preserves a successful Tool result when Change Store projection fails', async () => {
    const fingerprints = new Map<string, WorkspaceFileFingerprint>();
    const store = fakeStore({ failChangedFileWrite: true });
    const diagnostic = vi.fn();
    const changes = createChanges({ store, fingerprints, onDiagnostic: diagnostic });

    const result = await changes.trackToolExecution({
      scope: scope(),
      tool_execution: toolExecution('write_file', { path: 'src/new.ts' }),
      is_successful_outcome: isSuccessful,
      execute: async () => {
        fingerprints.set('/workspace/src/new.ts', fingerprint('new'));
        return succeeded('business-result');
      },
    });

    expect(result).toEqual(succeeded('business-result'));
    expect(diagnostic).toHaveBeenCalledWith(expect.objectContaining({ reason: 'store_failed', phase: 'project_change' }));
  });

  it('finalizes idempotently and never opens another set for the same finalized scope', async () => {
    const fingerprints = new Map<string, WorkspaceFileFingerprint>();
    const store = fakeStore();
    const changes = createChanges({ store, fingerprints });
    await changes.trackToolExecution({
      scope: scope(),
      tool_execution: toolExecution('write_file', { path: 'src/first.ts' }),
      is_successful_outcome: isSuccessful,
      execute: async () => {
        fingerprints.set('/workspace/src/first.ts', fingerprint('first'));
        return succeeded();
      },
    });

    const request = { ...scope(), finalized_at: '2026-05-16T00:01:00.000Z' };
    expect(changes.finalizeChangeSet(request)).toMatchObject({ status: 'finalized' });
    expect(changes.finalizeChangeSet(request)).toMatchObject({ status: 'finalized' });

    await changes.trackToolExecution({
      scope: scope(),
      tool_execution: toolExecution('write_file', { path: 'src/second.ts' }),
      is_successful_outcome: isSuccessful,
      execute: async () => {
        fingerprints.set('/workspace/src/second.ts', fingerprint('second'));
        return succeeded();
      },
    });
    expect(store.changeSets).toHaveLength(1);
    expect(store.files.map((file) => file.workspace_path)).toEqual(['src/first.ts']);
  });
});

function createChanges(options: {
  store: FakeWorkspaceStore;
  fingerprints: Map<string, WorkspaceFileFingerprint>;
  onDiagnostic?: (diagnostic: unknown) => void;
}) {
  let changeSetId = 0;
  let changedFileId = 0;
  return createWorkspaceChanges({
    store: options.store,
    path_policy: createWorkspacePathPolicy(),
    file_system: {
      async realpath(target) { return target; },
      async fingerprint(target) { return options.fingerprints.get(target) ?? { exists: false }; },
    },
    ids: {
      change_set_id: () => `change-set:${++changeSetId}`,
      changed_file_id: () => `changed-file:${++changedFileId}`,
    },
    now: () => '2026-05-16T00:00:00.000Z',
    platform: 'linux',
    on_diagnostic: options.onDiagnostic,
  });
}

function fingerprint(content_hash: string, modified_at_ms = 100): WorkspaceFileFingerprint {
  return { exists: true, size_bytes: 10, modified_at_ms, content_hash };
}
function scope() {
  return { workspace_id: 'workspace:one', session_id: 'session:one', run_id: 'run:one' };
}
function toolExecution(tool_name: string, input: unknown) {
  return { tool_name, input, workspace_root: '/workspace' };
}

interface FakeWorkspaceStore extends WorkspaceStore {
  changeSets: WorkspaceChangeSet[];
  files: WorkspaceChangedFile[];
}

function fakeStore(options: { failChangedFileWrite?: boolean } = {}): FakeWorkspaceStore {
  const store: FakeWorkspaceStore = {
    changeSets: [] as WorkspaceChangeSet[],
    files: [] as WorkspaceChangedFile[],
    upsertWorkspace: vi.fn(),
    findWorkspaceById: vi.fn(),
    findWorkspaceByRootPathKey: vi.fn(),
    listWorkspaces: vi.fn(() => []),
    updateWorkspaceStatus: vi.fn(),
    deleteWorkspace: vi.fn(() => 'not_found' as const),
    insertChangeSet(changeSet: WorkspaceChangeSet) {
      store.changeSets.push(changeSet);
      return changeSet;
    },
    findChangeSetById(changeSetId: string) {
      return store.changeSets.find((item) => item.change_set_id === changeSetId);
    },
    findOpenChangeSet(input: { workspace_id: string; session_id: string; run_id: string }) {
      return store.changeSets.find((item) => item.workspace_id === input.workspace_id
        && item.session_id === input.session_id && item.run_id === input.run_id && item.status === 'open');
    },
    listChangeSetsByRunId(runId: string) { return store.changeSets.filter((item) => item.run_id === runId); },
    finalizeChangeSet(input: { change_set_id: string; finalized_at: string }) {
      const changeSet = store.changeSets.find((item) => item.change_set_id === input.change_set_id);
      if (!changeSet) return undefined;
      changeSet.status = 'finalized';
      changeSet.finalized_at ??= input.finalized_at;
      changeSet.changed_file_count = store.files.filter((file) => file.change_set_id === input.change_set_id).length;
      return changeSet;
    },
    upsertChangedFile(file: WorkspaceChangedFile) {
      if (options.failChangedFileWrite) throw new Error('database unavailable');
      const existing = store.files.find((item) => item.change_set_id === file.change_set_id
        && item.workspace_path === file.workspace_path);
      if (existing) {
        existing.change_kind = file.change_kind;
        return existing;
      }
      store.files.push(file);
      return file;
    },
    listChangedFilesByChangeSetId(changeSetId: string) { return store.files.filter((item) => item.change_set_id === changeSetId); },
    listChangedFilesByRunId(runId: string) {
      const ids = new Set(store.changeSets.filter((item) => item.run_id === runId).map((item) => item.change_set_id));
      return store.files.filter((file) => ids.has(file.change_set_id));
    },
    getChangeSummary(changeSetId: string): WorkspaceChangeSummary | undefined {
      const change_set = store.changeSets.find((item) => item.change_set_id === changeSetId);
      return change_set ? { change_set, files: store.listChangedFilesByChangeSetId(changeSetId) } : undefined;
    },
  };
  return store;
}
