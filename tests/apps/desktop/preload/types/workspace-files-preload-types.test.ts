// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import { createRendererRuntimeIpcRequest } from '@megumi/desktop/renderer/shared/ipc/runtime-request';
import { api as preloadApi } from '@megumi/desktop/preload/api';
import type { MegumiAPI } from '@megumi/desktop/preload/types';

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    removeAllListeners: vi.fn(),
    removeListener: vi.fn(),
  },
}));

describe('workspace files preload API shape', () => {
  beforeEach(() => {
    vi.mocked(ipcRenderer.invoke).mockReset();
  });

  it('supports a typed workspace files list method', async () => {
    const list: MegumiAPI['workspace']['files']['list'] = vi.fn(async () => ({
      ok: true as const,
      data: {
        workspaceRoot: 'C:/all/work/study/megumi',
        directoryPath: '',
        entries: [{
          name: 'apps',
          relativePath: 'apps',
          kind: 'directory' as const,
          depth: 0,
          hidden: false,
          ignored: false,
        }],
      },
      meta: {
        requestId: 'ipc-workspace-files-list-1',
        channel: IPC_CHANNELS.workspace.files.list,
        handledAt: '2026-05-18T00:00:00.000Z',
      },
    }));
    const open: MegumiAPI['workspace']['files']['open'] = vi.fn(async () => ({
      ok: true as const,
      data: {
        workspaceRoot: 'C:/all/work/study/megumi',
        filePath: 'src/app.ts',
        opened: true as const,
      },
      meta: {
        requestId: 'ipc-workspace-files-open-1',
        channel: IPC_CHANNELS.workspace.files.open,
        handledAt: '2026-05-18T00:00:00.000Z',
      },
    }));
    const api: Pick<MegumiAPI, 'workspace'> = {
      workspace: {
        files: {
          list,
          open,
        },
      },
    };

    const request = createRendererRuntimeIpcRequest(IPC_CHANNELS.workspace.files.list, {
      workspaceRoot: 'C:/all/work/study/megumi',
      directoryPath: '',
    }, {
      requestId: 'ipc-workspace-files-list-1',
      createdAt: '2026-05-18T00:00:00.000Z',
    });

    await api.workspace.files.list(request);

    expect(preloadApi.workspace.files.list).toEqual(expect.any(Function));
    expect(api.workspace.files.list).toHaveBeenCalledWith(expect.objectContaining({
      meta: expect.objectContaining({
        channel: IPC_CHANNELS.workspace.files.list,
      }),
      payload: {
        workspaceRoot: 'C:/all/work/study/megumi',
        directoryPath: '',
      },
    }));
  });

  it('invokes the workspace files IPC channel with the exact request', async () => {
    const request = createRendererRuntimeIpcRequest(IPC_CHANNELS.workspace.files.list, {
      workspaceRoot: 'C:/all/work/study/megumi',
      directoryPath: 'apps',
    }, {
      requestId: 'ipc-workspace-files-list-2',
      createdAt: '2026-05-18T00:00:00.000Z',
    });
    const result = {
      ok: true as const,
      data: {
        workspaceRoot: 'C:/all/work/study/megumi',
        directoryPath: 'apps',
        entries: [],
      },
      meta: {
        requestId: 'ipc-workspace-files-list-2',
        channel: IPC_CHANNELS.workspace.files.list,
        handledAt: '2026-05-18T00:00:00.000Z',
      },
    };
    vi.mocked(ipcRenderer.invoke).mockResolvedValue(result);

    await expect(preloadApi.workspace.files.list(request)).resolves.toBe(result);

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.workspace.files.list,
      request,
    );
  });
});
