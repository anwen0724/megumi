/*
 * Protects Workspace lifecycle, normalized root identity, and authorized root queries.
 */
import { describe, expect, it, vi } from 'vitest';
import { createWorkspaceCatalog } from '../../../packages/agent/workspace/src/index';
import { createWorkspaceStoreFixture } from './workspace-store-fixture';

const directoryStat = () => ({ isDirectory: () => true });
const fileStat = () => ({ isDirectory: () => false });

describe('WorkspaceCatalog', () => {
  it('opens and reuses normalized Windows roots case-insensitively', async () => {
    const { database, store } = createWorkspaceStoreFixture();
    let now = '2026-05-19T00:00:00.000Z';
    try {
      const catalog = createWorkspaceCatalog({
        store,
        file_system: { stat: vi.fn(async () => directoryStat()) },
        platform: 'win32',
        now: () => now,
      });
      const first = await catalog.openWorkspace({ root_path: 'C:/Work/Megumi' });
      now = '2026-05-19T00:00:10.000Z';
      const second = await catalog.openWorkspace({ root_path: 'c:/work/megumi' });

      expect(first).toMatchObject({ status: 'opened', workspace: { name: 'Megumi', root_path_key: 'c:\\work\\megumi' } });
      expect(second).toMatchObject({ status: 'opened', workspace: { last_opened_at: now } });
      if (first.status === 'opened' && second.status === 'opened') {
        expect(second.workspace.workspace_id).toBe(first.workspace.workspace_id);
      }
      expect(store.listWorkspaces()).toHaveLength(1);
    } finally { database.close(); }
  });

  it('returns stable failures for missing and non-directory roots', async () => {
    const missingFixture = createWorkspaceStoreFixture();
    const fileFixture = createWorkspaceStoreFixture();
    try {
      const missing = createWorkspaceCatalog({
        store: missingFixture.store,
        file_system: { stat: async () => { throw new Error('missing'); } },
      });
      const file = createWorkspaceCatalog({
        store: fileFixture.store,
        file_system: { stat: async () => fileStat() },
      });
      await expect(missing.openWorkspace({ root_path: '/missing' })).resolves.toMatchObject({
        status: 'failed', failure: { code: 'workspace_path_missing' },
      });
      await expect(file.openWorkspace({ root_path: '/file.txt' })).resolves.toMatchObject({
        status: 'failed', failure: { code: 'workspace_path_not_directory' },
      });
    } finally {
      missingFixture.database.close();
      fileFixture.database.close();
    }
  });

  it('activates an existing Workspace with owner-controlled open time', async () => {
    const { database, store } = createWorkspaceStoreFixture();
    let now = '2026-05-19T00:00:00.000Z';
    try {
      const catalog = createWorkspaceCatalog({
        store,
        file_system: { stat: async () => directoryStat() },
        now: () => now,
      });
      const opened = await catalog.openWorkspace({ root_path: '/workspace' });
      if (opened.status !== 'opened') throw new Error('Workspace should open.');
      now = '2026-05-19T00:01:00.000Z';

      await expect(catalog.activateWorkspace({ workspace_id: opened.workspace.workspace_id }))
        .resolves.toMatchObject({
          status: 'activated',
          workspace: { last_opened_at: now, updated_at: now, status: 'available' },
        });
    } finally { database.close(); }
  });

  it('refreshes status, activates, lists authorized roots, and removes records', async () => {
    const { database, store } = createWorkspaceStoreFixture();
    const stat = vi.fn().mockResolvedValueOnce(directoryStat()).mockRejectedValue(new Error('missing'));
    try {
      const catalog = createWorkspaceCatalog({
        store,
        file_system: { stat },
        now: () => '2026-05-19T00:00:10.000Z',
      });
      const opened = await catalog.openWorkspace({ root_path: '/workspace' });
      if (opened.status !== 'opened') throw new Error('Workspace should open.');
      expect(catalog.getWorkspace({ workspace_id: opened.workspace.workspace_id })).toMatchObject({ status: 'found' });
      await expect(catalog.listWorkspaces({ refresh_status: true })).resolves.toMatchObject({
        workspaces: [{ status: 'missing' }],
      });
      expect(catalog.listAuthorizedWorkspaceRoots()).toEqual({ roots: [] });
      expect(catalog.removeWorkspace({ workspace_id: opened.workspace.workspace_id })).toMatchObject({ status: 'removed' });
    } finally { database.close(); }
  });
});
