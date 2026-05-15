// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import { registerAgentHandlers } from '@megumi/desktop/main/ipc/handlers/agent.handler';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

describe('registerAgentHandlers', () => {
  it('registers agent lifecycle channels', async () => {
    const { ipcMain } = await import('electron');

    registerAgentHandlers({
      createSession: vi.fn(),
      listSessions: vi.fn(),
      startRun: vi.fn(),
    });

    expect(ipcMain.handle).toHaveBeenCalledWith(IPC_CHANNELS.agent.session.create, expect.any(Function));
    expect(ipcMain.handle).toHaveBeenCalledWith(IPC_CHANNELS.agent.session.list, expect.any(Function));
    expect(ipcMain.handle).toHaveBeenCalledWith(IPC_CHANNELS.agent.run.start, expect.any(Function));
  });
});
