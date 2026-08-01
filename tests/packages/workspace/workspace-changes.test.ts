/* Protects structured Tool Effect projection and projection-failure isolation. */
import { describe, expect, it, vi } from 'vitest';
import {
  createWorkspaceChanges,
  type WorkspaceChangedFile,
  type WorkspaceChangeSet,
  type WorkspaceToolEffectReport,
  type WorkspaceStore,
} from '../../../packages/workspace/src/index';

type Result = { type: 'succeeded' | 'failed'; value?: string; effectReport?: WorkspaceToolEffectReport };
const result = (effectReport?: WorkspaceToolEffectReport, type: Result['type'] = 'succeeded'): Result => ({ type, ...(effectReport ? { effectReport } : {}) });
const workspacePath = (value: string) => ({ location: 'workspace' as const, path: value });
const externalPath = (value: string) => ({ location: 'external' as const, path: value });
const report = (effects: WorkspaceToolEffectReport['effects'], coverage: WorkspaceToolEffectReport['coverage'] = 'complete'): WorkspaceToolEffectReport => ({ coverage, effects, itemFailures: [], ...(coverage === 'unknown' ? { reason: 'observer unavailable' } : {}) });

describe('WorkspaceChanges', () => {
  it('records created, copied, moved, and deleted effects without inspecting Tool names', async () => {
    const store = fakeStore();
    const changes = createChanges(store);
    await changes.trackToolExecution({
      scope: scope(),
      execute: async () => result(report([
        { type: 'created', path: workspacePath('src/new.ts'), pathType: 'file' },
        { type: 'copied', source: workspacePath('src/a.ts'), destination: workspacePath('src/b.ts'), pathType: 'file' },
        { type: 'moved', source: workspacePath('notes/old'), destination: workspacePath('notes/new'), pathType: 'directory' },
        { type: 'deleted', path: workspacePath('tmp.txt'), pathType: 'file', recoverable: true },
      ])),
    });
    expect(store.files).toMatchObject([
      { workspace_path: 'src/new.ts', effect_type: 'created', change_kind: 'created' },
      { workspace_path: 'src/b.ts', effect_type: 'copied', source_workspace_path: 'src/a.ts', destination_workspace_path: 'src/b.ts' },
      { workspace_path: 'notes/new', effect_type: 'moved', path_type: 'directory' },
      { workspace_path: 'tmp.txt', effect_type: 'deleted', recoverable: true },
    ]);
    expect(store.changeSets).toHaveLength(1);
  });

  it('keeps external-only effects out of WorkspaceChanges and projects a move out as deletion', async () => {
    const externalOnlyStore = fakeStore();
    await createChanges(externalOnlyStore).trackToolExecution({
      scope: scope(),
      execute: async () => result(report([{
        type: 'created',
        path: externalPath('C:/outside/new.ts'),
        pathType: 'file',
      }])),
    });
    expect(externalOnlyStore.changeSets).toEqual([]);
    expect(externalOnlyStore.files).toEqual([]);

    const mixedStore = fakeStore();
    await createChanges(mixedStore).trackToolExecution({
      scope: scope(),
      execute: async () => result(report([{
        type: 'moved',
        source: workspacePath('notes/paper.md'),
        destination: externalPath('C:/archive/paper.md'),
        pathType: 'file',
      }])),
    });
    expect(mixedStore.files).toMatchObject([{
      workspace_path: 'notes/paper.md',
      effect_type: 'moved',
      change_kind: 'deleted',
    }]);
  });
  it('records effects from a failed result and preserves partial completion facts', async () => {
    const store = fakeStore();
    await createChanges(store).trackToolExecution({
      scope: scope(),
      execute: async () => result(report([{ type: 'modified', path: workspacePath('partial.md'), pathType: 'file' }]), 'failed'),
    });
    expect(store.files).toMatchObject([{ workspace_path: 'partial.md', effect_type: 'modified' }]);
  });

  it('does not create a false no-change fact for unknown coverage', async () => {
    const store = fakeStore();
    await createChanges(store).trackToolExecution({ scope: scope(), execute: async () => result(report([], 'unknown')) });
    expect(store.changeSets).toMatchObject([{ effect_coverage: 'unknown', changed_file_count: 0 }]);
    expect(store.files).toEqual([]);
  });

  it('preserves the Tool result when Change Store projection fails', async () => {
    const store = fakeStore({ failChangedFileWrite: true });
    const diagnostic = vi.fn();
    const changes = createChanges(store, diagnostic);
    const businessResult = result(report([{ type: 'created', path: workspacePath('new.md'), pathType: 'file' }]));
    await expect(changes.trackToolExecution({ scope: scope(), execute: async () => businessResult })).resolves.toBe(businessResult);
    expect(diagnostic).toHaveBeenCalledWith(expect.objectContaining({ reason: 'store_failed', phase: 'project_change' }));
  });

  it('finalizes idempotently and never opens another set for the same finalized scope', async () => {
    const store = fakeStore();
    const changes = createChanges(store);
    await changes.trackToolExecution({ scope: scope(), execute: async () => result(report([{ type: 'created', path: workspacePath('first.ts'), pathType: 'file' }])) });
    const request = { ...scope(), finalized_at: '2026-05-16T00:01:00.000Z' };
    expect(changes.finalizeChangeSet(request)).toMatchObject({ status: 'finalized' });
    expect(changes.finalizeChangeSet(request)).toMatchObject({ status: 'finalized' });
    await changes.trackToolExecution({ scope: scope(), execute: async () => result(report([{ type: 'created', path: workspacePath('second.ts'), pathType: 'file' }])) });
    expect(store.files.map((file) => file.workspace_path)).toEqual(['first.ts']);
  });
});

function createChanges(store: FakeWorkspaceStore, onDiagnostic?: (diagnostic: unknown) => void) {
  let changeSetId = 0;
  let changedFileId = 0;
  return createWorkspaceChanges({
    store,
    ids: {
      change_set_id: () => `change-set:${++changeSetId}`,
      changed_file_id: () => `changed-file:${++changedFileId}`,
    },
    now: () => '2026-05-16T00:00:00.000Z',
    on_diagnostic: onDiagnostic,
  });
}

function scope() { return { workspace_id: 'workspace:one', session_id: 'session:one', run_id: 'run:one' }; }

interface FakeWorkspaceStore extends WorkspaceStore { changeSets: WorkspaceChangeSet[]; files: WorkspaceChangedFile[] }
function fakeStore(options: { failChangedFileWrite?: boolean } = {}): FakeWorkspaceStore {
  const store = {
    changeSets: [] as WorkspaceChangeSet[], files: [] as WorkspaceChangedFile[],
    upsertWorkspace: vi.fn(), findWorkspaceById: vi.fn(), findWorkspaceByRootPathKey: vi.fn(), listWorkspaces: vi.fn(() => []),
    updateWorkspaceStatus: vi.fn(), deleteWorkspace: vi.fn(() => 'not_found' as const),
    insertChangeSet(changeSet: WorkspaceChangeSet) {
      const existing = store.changeSets.find((item) => item.change_set_id === changeSet.change_set_id);
      if (existing) { Object.assign(existing, changeSet); return existing; }
      store.changeSets.push(changeSet); return changeSet;
    },
    findChangeSetById(id: string) { return store.changeSets.find((item) => item.change_set_id === id); },
    findOpenChangeSet(input: { workspace_id: string; session_id: string; run_id: string }) {
      return store.changeSets.find((item) => item.workspace_id === input.workspace_id && item.session_id === input.session_id && item.run_id === input.run_id && item.status === 'open');
    },
    listChangeSetsByRunId(runId: string) { return store.changeSets.filter((item) => item.run_id === runId); },
    finalizeChangeSet(input: { change_set_id: string; finalized_at: string }) {
      const item = store.changeSets.find((candidate) => candidate.change_set_id === input.change_set_id);
      if (!item) return undefined;
      item.status = 'finalized'; item.finalized_at ??= input.finalized_at;
      item.changed_file_count = store.files.filter((file) => file.change_set_id === item.change_set_id).length;
      return item;
    },
    upsertChangedFile(file: WorkspaceChangedFile) {
      if (options.failChangedFileWrite) throw new Error('database unavailable');
      const existing = store.files.find((item) => item.change_set_id === file.change_set_id && item.workspace_path === file.workspace_path);
      if (existing) { Object.assign(existing, file, { changed_file_id: existing.changed_file_id, created_at: existing.created_at }); return existing; }
      store.files.push(file); return file;
    },
    listChangedFilesByChangeSetId(id: string) { return store.files.filter((file) => file.change_set_id === id); },
    listChangedFilesByRunId(runId: string) { const ids = new Set(store.changeSets.filter((item) => item.run_id === runId).map((item) => item.change_set_id)); return store.files.filter((file) => ids.has(file.change_set_id)); },
    getChangeSummary(id: string) { const change_set = store.changeSets.find((item) => item.change_set_id === id); return change_set ? { change_set, files: store.files.filter((file) => file.change_set_id === id) } : undefined; },
  } satisfies FakeWorkspaceStore;
  return store;
}