// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import { useWorkspaceFilesStore } from '@megumi/desktop/renderer/entities/workspace-files/store';

function installWorkspaceFilesMock() {
  const files = {
    list: vi.fn(async () => ({
      ok: true,
      data: {
        workspaceRoot: 'C:/all/work/study/megumi',
        directoryPath: '',
        entries: [
          {
            name: 'apps',
            relativePath: 'apps',
            kind: 'directory',
            depth: 0,
            hidden: false,
            ignored: false,
          },
          {
            name: 'README.md',
            relativePath: 'README.md',
            kind: 'file',
            depth: 0,
            hidden: false,
            ignored: false,
          },
        ],
      },
      meta: {
        requestId: 'ipc-workspace-files-list-1',
        channel: IPC_CHANNELS.workspace.files.list,
        handledAt: '2026-05-18T00:00:00.100Z',
      },
    })),
  };

  Object.defineProperty(window, 'megumi', {
    configurable: true,
    value: {
      workspace: {
        files,
      },
    },
  });

  return files;
}

describe('useWorkspaceFilesStore', () => {
  beforeEach(() => {
    useWorkspaceFilesStore.getState().reset();
    vi.restoreAllMocks();
  });

  it('loads a directory through the preload workspace files API', async () => {
    const files = installWorkspaceFilesMock();

    await useWorkspaceFilesStore.getState().loadDirectory({
      workspaceRoot: 'C:/all/work/study/megumi',
      directoryPath: '',
    });

    expect(files.list).toHaveBeenCalledWith(expect.objectContaining({
      payload: {
        workspaceRoot: 'C:/all/work/study/megumi',
        directoryPath: '',
      },
      meta: expect.objectContaining({
        channel: IPC_CHANNELS.workspace.files.list,
        source: 'renderer',
      }),
      context: expect.objectContaining({
        operationName: 'workspace.files.list',
        source: 'renderer',
      }),
    }));
    expect(useWorkspaceFilesStore.getState().entriesByDirectory['']).toEqual([
      expect.objectContaining({ name: 'apps', relativePath: 'apps', kind: 'directory' }),
      expect.objectContaining({ name: 'README.md', relativePath: 'README.md', kind: 'file' }),
    ]);
    expect(useWorkspaceFilesStore.getState().loadingDirectories).not.toContain('');
  });

  it('tracks expanded directories and selected paths', () => {
    useWorkspaceFilesStore.getState().toggleDirectory('apps');
    useWorkspaceFilesStore.getState().setSelectedPath('apps/desktop');

    expect(useWorkspaceFilesStore.getState().expandedDirectoryPaths).toEqual(['apps']);
    expect(useWorkspaceFilesStore.getState().selectedPath).toBe('apps/desktop');

    useWorkspaceFilesStore.getState().toggleDirectory('apps');

    expect(useWorkspaceFilesStore.getState().expandedDirectoryPaths).toEqual([]);
  });

  it('stores readable errors and clears loading state when directory loading fails', async () => {
    Object.defineProperty(window, 'megumi', {
      configurable: true,
      value: {
        workspace: {
          files: {
            list: vi.fn(async () => ({
              ok: false,
              error: {
                code: 'workspace_files_list_failed',
                message: 'Megumi could not list workspace files.',
                severity: 'error',
                retryable: true,
                source: 'main',
                debugId: 'debug-workspace-files-1',
              },
              meta: {
                requestId: 'ipc-workspace-files-list-1',
                channel: IPC_CHANNELS.workspace.files.list,
                handledAt: '2026-05-18T00:00:00.100Z',
              },
            })),
          },
        },
      },
    });

    await useWorkspaceFilesStore.getState().loadDirectory({
      workspaceRoot: 'C:/all/work/study/megumi',
      directoryPath: 'apps',
    });

    expect(useWorkspaceFilesStore.getState().error).toBe('Megumi could not list workspace files.');
    expect(useWorkspaceFilesStore.getState().loadingDirectories).not.toContain('apps');
  });
});
