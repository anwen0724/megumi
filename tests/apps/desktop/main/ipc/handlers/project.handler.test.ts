// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/shared/ipc';
import { registerProjectHandlers } from '@megumi/desktop/main/ipc/handlers/project.handler';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

function createRequest(channel: string, payload: object) {
  return {
    requestId: `ipc-${channel}`,
    payload,
    meta: {
      channel,
      createdAt: '2026-05-19T00:00:00.000Z',
      source: 'renderer',
    },
  };
}

describe('registerProjectHandlers', () => {
  beforeEach(async () => {
    const { ipcMain } = await import('electron');
    vi.mocked(ipcMain.handle).mockClear();
  });

  it('registers project IPC channels', async () => {
    const { ipcMain } = await import('electron');

    const service = {
      listProjects: vi.fn(async () => []),
      useExistingProject: vi.fn(async () => ({ cancelled: true as const })),
      openProject: vi.fn(),
      removeProject: vi.fn(),
      listAuthorizedWorkspaceRoots: vi.fn(() => []),
    };

    registerProjectHandlers(service);

    expect(ipcMain.handle).toHaveBeenCalledWith(IPC_CHANNELS.project.list, expect.any(Function));
    expect(ipcMain.handle).toHaveBeenCalledWith(IPC_CHANNELS.project.useExisting, expect.any(Function));
    expect(ipcMain.handle).toHaveBeenCalledWith(IPC_CHANNELS.project.open, expect.any(Function));
    expect(ipcMain.handle).toHaveBeenCalledWith(IPC_CHANNELS.project.remove, expect.any(Function));
  });

  it('calls the project service from valid runtime IPC requests', async () => {
    const { ipcMain } = await import('electron');
    const project = {
      projectId: 'project:abc123',
      name: 'megumi',
      repoPath: 'C:/all/work/study/megumi',
      repoPathKey: 'c:/all/work/study/megumi',
      status: 'available' as const,
      createdAt: '2026-05-19T00:00:00.000Z',
      lastOpenedAt: '2026-05-19T00:00:01.000Z',
    };
    const service = {
      listProjects: vi.fn(async () => [project]),
      useExistingProject: vi.fn(async () => ({ cancelled: false as const, project })),
      openProject: vi.fn(async () => project),
      removeProject: vi.fn(() => ({ projectId: project.projectId, removed: true })),
      listAuthorizedWorkspaceRoots: vi.fn(() => [project.repoPath]),
    };

    registerProjectHandlers(service);

    const listHandler = vi.mocked(ipcMain.handle).mock.calls.find(
      ([channel]) => channel === IPC_CHANNELS.project.list,
    )?.[1];
    const useExistingHandler = vi.mocked(ipcMain.handle).mock.calls.find(
      ([channel]) => channel === IPC_CHANNELS.project.useExisting,
    )?.[1];
    const openHandler = vi.mocked(ipcMain.handle).mock.calls.find(
      ([channel]) => channel === IPC_CHANNELS.project.open,
    )?.[1];
    const removeHandler = vi.mocked(ipcMain.handle).mock.calls.find(
      ([channel]) => channel === IPC_CHANNELS.project.remove,
    )?.[1];

    await expect(
      listHandler?.({} as Electron.IpcMainInvokeEvent, createRequest(IPC_CHANNELS.project.list, {})),
    ).resolves.toMatchObject({
      ok: true,
      data: { projects: [project] },
    });
    await expect(
      useExistingHandler?.({} as Electron.IpcMainInvokeEvent, createRequest(IPC_CHANNELS.project.useExisting, {})),
    ).resolves.toMatchObject({
      ok: true,
      data: { cancelled: false, project },
    });
    await expect(
      openHandler?.({} as Electron.IpcMainInvokeEvent, createRequest(IPC_CHANNELS.project.open, { projectId: project.projectId })),
    ).resolves.toMatchObject({
      ok: true,
      data: { project },
    });
    await expect(
      removeHandler?.({} as Electron.IpcMainInvokeEvent, createRequest(IPC_CHANNELS.project.remove, { projectId: project.projectId })),
    ).resolves.toMatchObject({
      ok: true,
      data: { projectId: project.projectId, removed: true },
    });
  });
});

