import { describe, expect, it, vi } from 'vitest';
import { createWorkspaceHost } from '@megumi/product/host-interface/workspace-host';

describe('WorkspaceHost files', () => {
  it('maps canonical Workspace file results and opens only the resolved absolute path', async () => {
    const openPath = vi.fn(async () => ({ status: 'opened' as const }));
    const host = createWorkspaceHost({
      workspaceService: workspaceServiceStub(),
      workspaceFilesService: {
        listDirectory: vi.fn(async () => ({
          status: 'ok' as const,
          workspace_id: 'workspace:1',
          workspace_root: 'C:/work/megumi',
          directory_path: '',
          entries: [{
            name: 'README.md',
            relative_path: 'README.md',
            type: 'file' as const,
            depth: 0,
            hidden: false,
            size_bytes: 12,
            modified_at: '2026-07-10T00:00:00.000Z',
          }],
        })),
        resolveFile: vi.fn(() => ({
          status: 'ok' as const,
          workspace_id: 'workspace:1',
          workspace_root: 'C:/work/megumi',
          file_path: 'README.md',
          absolute_path: 'C:/work/megumi/README.md',
        })),
      },
      fileOpen: { openPath },
    });

    await expect(host.listFiles({ projectId: 'workspace:1', directoryPath: '' })).resolves.toMatchObject({
      projectId: 'workspace:1',
      entries: [{ relativePath: 'README.md', sizeBytes: 12 }],
    });
    await expect(host.openFile({ projectId: 'workspace:1', filePath: 'README.md' })).resolves.toMatchObject({
      projectId: 'workspace:1',
      status: 'opened',
    });
    expect(openPath).toHaveBeenCalledWith('C:/work/megumi/README.md');
  });

  it('projects file open adapter failures without using empty-string sentinels', async () => {
    const host = createWorkspaceHost({
      workspaceService: workspaceServiceStub(),
      workspaceFilesService: {
        listDirectory: vi.fn(),
        resolveFile: vi.fn(() => ({
          status: 'ok' as const,
          workspace_id: 'workspace:1',
          workspace_root: 'C:/work/megumi',
          file_path: 'README.md',
          absolute_path: 'C:/work/megumi/README.md',
        })),
      },
      fileOpen: { openPath: vi.fn(async () => ({ status: 'failed' as const, message: 'No app associated.' })) },
    });

    await expect(host.openFile({ projectId: 'workspace:1', filePath: 'README.md' })).resolves.toEqual({
      status: 'failed',
      projectId: 'workspace:1',
      filePath: 'README.md',
      failure: { code: 'file_open_failed', message: 'No app associated.' },
    });
  });

  it('returns workspace file owner statuses from listFiles and openFile without throwing', async () => {
    const host = createWorkspaceHost({
      workspaceService: workspaceServiceStub(),
      workspaceFilesService: {
        listDirectory: vi.fn(async () => ({
          status: 'path_rejected' as const,
          reason: 'outside_workspace' as const,
        })),
        resolveFile: vi.fn(() => ({
          status: 'workspace_not_found' as const,
          workspace_id: 'workspace:missing',
        })),
      },
      fileOpen: { openPath: vi.fn() },
    });

    await expect(host.listFiles({ projectId: 'workspace:1', directoryPath: '../outside' })).resolves.toEqual({
      status: 'path_rejected',
      reason: 'outside_workspace',
    });
    await expect(host.openFile({ projectId: 'workspace:missing', filePath: 'README.md' })).resolves.toEqual({
      status: 'workspace_not_found',
      projectId: 'workspace:missing',
    });
  });
});

function workspaceServiceStub() {
  return {
    openWorkspace: vi.fn(),
    activateWorkspace: vi.fn(),
    getWorkspace: vi.fn(),
    listWorkspaces: vi.fn(async () => ({ workspaces: [] })),
    removeWorkspace: vi.fn(() => ({ status: 'not_found' as const, workspace_id: 'workspace:1' })),
    listAuthorizedWorkspaceRoots: vi.fn(() => ({ roots: [] })),
  };
}
