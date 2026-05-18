// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import { registerWorkspaceFilesHandlers } from '@megumi/desktop/main/ipc/handlers/workspace-files.handler';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

describe('registerWorkspaceFilesHandlers', () => {
  beforeEach(async () => {
    const { ipcMain } = await import('electron');
    vi.mocked(ipcMain.handle).mockClear();
  });

  it('registers the workspace files list IPC channel', async () => {
    const { ipcMain } = await import('electron');

    registerWorkspaceFilesHandlers({
      listDirectory: vi.fn(),
    });

    expect(ipcMain.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.workspace.files.list,
      expect.any(Function),
    );
  });

  it('calls the workspace files service from a valid runtime IPC request', async () => {
    const { ipcMain } = await import('electron');
    const service = {
      listDirectory: vi.fn(async () => ({
        workspaceRoot: 'C:/all/work/study/megumi',
        directoryPath: '',
        entries: [{
          name: 'apps',
          relativePath: 'apps',
          kind: 'directory' as const,
          depth: 0,
          hidden: false,
          ignored: false,
          mtime: '2026-05-18T00:00:00.000Z',
        }],
      })),
    };

    registerWorkspaceFilesHandlers(service);
    const handler = vi.mocked(ipcMain.handle).mock.calls[0]?.[1];
    const result = await handler?.({} as Electron.IpcMainInvokeEvent, {
      requestId: 'ipc-workspace-files-list-1',
      payload: {
        workspaceRoot: 'C:/all/work/study/megumi',
        directoryPath: '',
      },
      meta: {
        channel: IPC_CHANNELS.workspace.files.list,
        createdAt: '2026-05-18T00:00:00.000Z',
        source: 'renderer',
      },
    });

    expect(service.listDirectory).toHaveBeenCalledWith({
      workspaceRoot: 'C:/all/work/study/megumi',
      directoryPath: '',
    });
    expect(result).toMatchObject({
      ok: true,
      data: {
        workspaceRoot: 'C:/all/work/study/megumi',
        directoryPath: '',
        entries: [{
          name: 'apps',
          relativePath: 'apps',
          kind: 'directory',
        }],
      },
      meta: {
        requestId: 'ipc-workspace-files-list-1',
        channel: IPC_CHANNELS.workspace.files.list,
      },
    });
  });
});
