import { describe, expect, it, vi } from 'vitest';
import { createWorkspaceHost } from '@megumi/product/host-interface/workspace-host';

describe('WorkspaceHost semantics', () => {
  it('projects remove results without collapsing owner statuses into booleans', () => {
    const host = createWorkspaceHost({
      workspaceService: {
        openWorkspace: vi.fn(),
        activateWorkspace: vi.fn(),
        getWorkspace: vi.fn(),
        listWorkspaces: vi.fn(async () => ({ workspaces: [] })),
        removeWorkspace: vi.fn(() => ({ status: 'not_found' as const, workspace_id: 'workspace:1' })),
        listAuthorizedWorkspaceRoots: vi.fn(() => ({ roots: [] })),
      } as never,
      workspaceFilesService: {} as never,
    });

    expect(host.removeProject({ projectId: 'workspace:1' })).toEqual({
      status: 'not_found',
      projectId: 'workspace:1',
    });
  });

  it('uses truthful project timestamp names in Host DTOs', async () => {
    const host = createWorkspaceHost({
      workspaceService: {
        listWorkspaces: vi.fn(async () => ({
          workspaces: [{
            workspace_id: 'workspace:1',
            name: 'megumi',
            root_path: 'C:/work/megumi',
            root_path_key: 'c:/work/megumi',
            status: 'available',
            created_at: '2026-07-10T00:00:00.000Z',
            updated_at: '2026-07-10T00:01:00.000Z',
            last_opened_at: '2026-07-10T00:02:00.000Z',
          }],
        })),
      } as never,
      workspaceFilesService: {} as never,
    });

    await expect(host.listProjects()).resolves.toEqual({
      projects: [expect.objectContaining({
        createdAt: '2026-07-10T00:00:00.000Z',
        lastOpenedAt: '2026-07-10T00:02:00.000Z',
      })],
    });
  });
});
