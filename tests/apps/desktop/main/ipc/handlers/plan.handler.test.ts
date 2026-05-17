import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import { registerPlanHandlers } from '@megumi/desktop/main/ipc/handlers/plan.handler';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

describe('registerPlanHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers primary plan IPC channels and deprecated agent bridges', async () => {
    const { ipcMain } = await import('electron');
    const service = {
      getPlanByRun: vi.fn(),
      updatePlanStatus: vi.fn(),
    };

    registerPlanHandlers(service);

    expect(ipcMain.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.plan.byRunGet,
      expect.any(Function),
    );
    expect(ipcMain.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.plan.statusUpdate,
      expect.any(Function),
    );
    expect(ipcMain.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.plan.byRunGet,
      expect.any(Function),
    );
    expect(ipcMain.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.plan.statusUpdate,
      expect.any(Function),
    );
  });
});
