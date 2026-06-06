// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import { PathSandboxViolationError } from '@megumi/security/sandbox-policy';
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
    expect(ipcMain.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.workspace.files.open,
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

  it('opens a workspace file from a valid runtime IPC request', async () => {
    const { ipcMain } = await import('electron');
    const service = {
      listDirectory: vi.fn(),
      openFile: vi.fn(async () => ({
        workspaceRoot: 'C:/all/work/study/megumi',
        filePath: 'src/app.ts',
        opened: true,
      })),
    };

    registerWorkspaceFilesHandlers(service);
    const openHandler = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) =>
      channel === IPC_CHANNELS.workspace.files.open
    )?.[1];
    const result = await openHandler?.({} as Electron.IpcMainInvokeEvent, {
      requestId: 'ipc-workspace-files-open-1',
      payload: {
        workspaceRoot: 'C:/all/work/study/megumi',
        filePath: 'src/app.ts',
      },
      meta: {
        channel: IPC_CHANNELS.workspace.files.open,
        createdAt: '2026-05-18T00:00:00.000Z',
        source: 'renderer',
      },
    });

    expect(service.openFile).toHaveBeenCalledWith({
      workspaceRoot: 'C:/all/work/study/megumi',
      filePath: 'src/app.ts',
    });
    expect(result).toMatchObject({
      ok: true,
      data: {
        workspaceRoot: 'C:/all/work/study/megumi',
        filePath: 'src/app.ts',
        opened: true,
      },
      meta: {
        requestId: 'ipc-workspace-files-open-1',
        channel: IPC_CHANNELS.workspace.files.open,
      },
    });
  });

  it('maps sandbox path violations to workspace_path_denied', async () => {
    const { ipcMain } = await import('electron');
    const service = {
      listDirectory: vi.fn(async () => {
        throw new PathSandboxViolationError('C:/all/work/study/megumi', '../outside');
      }),
    };

    registerWorkspaceFilesHandlers(service);
    const handler = vi.mocked(ipcMain.handle).mock.calls[0]?.[1];
    const result = await handler?.({} as Electron.IpcMainInvokeEvent, createWorkspaceFilesRequest());

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'workspace_path_denied',
        retryable: false,
        source: 'main',
      },
    });
  });

  it('maps generic service failures to retryable ipc_handler_failed', async () => {
    const { ipcMain } = await import('electron');
    const service = {
      listDirectory: vi.fn(async () => {
        throw new Error('disk unavailable');
      }),
    };

    registerWorkspaceFilesHandlers(service);
    const handler = vi.mocked(ipcMain.handle).mock.calls[0]?.[1];
    const result = await handler?.({} as Electron.IpcMainInvokeEvent, createWorkspaceFilesRequest());

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'ipc_handler_failed',
        retryable: true,
        source: 'main',
      },
    });
  });
});

function createWorkspaceFilesRequest() {
  return {
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
  };
}
