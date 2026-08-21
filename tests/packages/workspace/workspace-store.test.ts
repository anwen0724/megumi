/*
 * Protects Workspace-owned Database mappings and idempotent persistence behavior.
 */
import { describe, expect, it } from 'vitest';
import type {
  Workspace,
  WorkspaceChangedFile,
  WorkspaceChangeSet,
} from '../../../packages/workspace/src/index';
import { createWorkspaceStoreFixture } from './workspace-store-fixture';

const workspace = (overrides: Partial<Workspace> = {}): Workspace => ({
  workspace_id: 'workspace:one',
  name: 'One',
  root_path: '/work/one',
  root_path_key: '/work/one',
  status: 'available',
  created_at: '2026-05-16T00:00:00.000Z',
  updated_at: '2026-05-16T00:00:00.000Z',
  last_opened_at: '2026-05-16T00:00:00.000Z',
  ...overrides,
});
const changeSet = (overrides: Partial<WorkspaceChangeSet> = {}): WorkspaceChangeSet => ({
  change_set_id: 'change-set:one',
  workspace_id: 'workspace:one',
  session_id: 'session:one',
  execution_id: 'run:one',
  status: 'open',
  effect_coverage: 'complete',
  changed_file_count: 0,
  created_at: '2026-05-16T00:00:00.000Z',
  ...overrides,
});
const changedFile = (overrides: Partial<WorkspaceChangedFile> = {}): WorkspaceChangedFile => ({
  changed_file_id: 'changed-file:one',
  change_set_id: 'change-set:one',
  workspace_path: 'src/index.ts',
  change_kind: 'created',
  effect_type: 'created',
  path_type: 'file',
  created_at: '2026-05-16T00:00:01.000Z',
  ...overrides,
});

describe('WorkspaceStore', () => {
  it('upserts roots without duplicating Workspace identity', () => {
    const { database, store } = createWorkspaceStoreFixture();
    try {
      expect(store.upsertWorkspace(workspace())).toEqual(workspace());
      expect(store.upsertWorkspace(workspace({
        workspace_id: 'workspace:other', name: 'Renamed', updated_at: '2026-05-17T00:00:00.000Z',
      }))).toMatchObject({ workspace_id: 'workspace:one', name: 'Renamed' });
      expect(store.listWorkspaces()).toHaveLength(1);
    } finally { database.close(); }
  });

  it('lists Workspaces by last opened time descending', () => {
    const { database, store } = createWorkspaceStoreFixture();
    try {
      store.upsertWorkspace(workspace({
        workspace_id: 'workspace:old', root_path: '/work/old', root_path_key: '/work/old',
      }));
      store.upsertWorkspace(workspace({
        workspace_id: 'workspace:new', root_path: '/work/new', root_path_key: '/work/new',
        last_opened_at: '2026-05-17T00:00:00.000Z',
      }));
      expect(store.listWorkspaces().map((item) => item.workspace_id)).toEqual([
        'workspace:new', 'workspace:old',
      ]);
    } finally { database.close(); }
  });

  it('stores, upserts, summarizes, and idempotently finalizes Change facts', () => {
    const { database, store } = createWorkspaceStoreFixture();
    try {
      store.upsertWorkspace(workspace());
      store.insertChangeSet(changeSet());
      store.upsertChangedFile(changedFile());
      store.upsertChangedFile(changedFile({ changed_file_id: 'changed-file:other', change_kind: 'modified', effect_type: 'modified' }));

      const first = store.finalizeChangeSet({
        change_set_id: 'change-set:one', finalized_at: '2026-05-16T00:01:00.000Z',
      });
      const second = store.finalizeChangeSet({
        change_set_id: 'change-set:one', finalized_at: '2026-05-16T00:02:00.000Z',
      });
      expect(first).toEqual(changeSet({
        status: 'finalized', changed_file_count: 1, finalized_at: '2026-05-16T00:01:00.000Z',
      }));
      expect(second).toEqual(first);
      expect(store.getChangeSummary('change-set:one')).toEqual({
        change_set: first,
        files: [changedFile({ change_kind: 'modified', effect_type: 'modified' })],
      });
    } finally { database.close(); }
  });

  it('blocks removing a Workspace that owns Change facts without querying other Owner tables', () => {
    const { database, store } = createWorkspaceStoreFixture();
    try {
      store.upsertWorkspace(workspace());
      store.insertChangeSet(changeSet());
      expect(store.deleteWorkspace('workspace:one')).toBe('blocked');
      expect(store.findWorkspaceById('workspace:one')).toEqual(workspace());
    } finally { database.close(); }
  });

  it('uses Database constraints instead of querying another Owner table', () => {
    const { database, store } = createWorkspaceStoreFixture();
    try {
      database.prepare({ sql: `
        CREATE TABLE external_business_facts (
          fact_id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id)
        )
      ` }).run();
      store.upsertWorkspace(workspace());
      database.prepare({ sql: `
        INSERT INTO external_business_facts (fact_id, workspace_id)
        VALUES ('fact:one', 'workspace:one')
      ` }).run();

      expect(store.deleteWorkspace('workspace:one')).toBe('blocked');
      expect(store.findWorkspaceById('workspace:one')).toEqual(workspace());
    } finally { database.close(); }
  });
});
