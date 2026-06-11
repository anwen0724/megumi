// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/shared/ipc';
import { registerRunContextHandlers } from '@megumi/desktop/main/ipc/handlers/run-context.handler';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

describe('registerRunContextHandlers', () => {
  beforeEach(async () => {
    const { ipcMain } = await import('electron');
    vi.mocked(ipcMain.handle).mockClear();
  });

  it('registers primary run context IPC channels and deprecated agent bridges', async () => {
    const { ipcMain } = await import('electron');

    registerRunContextHandlers({
      getBaselineContext: vi.fn(),
      listWorkspaceSourcesByRun: vi.fn(),
    });

    expect(ipcMain.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.runContext.baselineGet,
      expect.any(Function),
    );
    expect(ipcMain.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.runContext.sourcesList,
      expect.any(Function),
    );
    expect(ipcMain.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.runContext.baselineGet,
      expect.any(Function),
    );
    expect(ipcMain.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.runContext.sourcesList,
      expect.any(Function),
    );
  });
});

