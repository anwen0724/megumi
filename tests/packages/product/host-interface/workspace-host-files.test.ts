import { describe, expect, it, vi } from 'vitest';
import { createWorkspaceHost } from '@megumi/product/host-interface/workspace-host';

describe('WorkspaceHost files', () => {
  it('maps canonical Workspace file results and opens only the resolved absolute path', async () => {
    const openPath = vi.fn(async () => '');
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
      opened: true,
    });
    expect(openPath).toHaveBeenCalledWith('C:/work/megumi/README.md');
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
