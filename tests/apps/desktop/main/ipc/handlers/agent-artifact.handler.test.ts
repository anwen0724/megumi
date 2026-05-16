import { afterEach, describe, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import { registerAgentArtifactHandlers } from '@megumi/desktop/main/ipc/handlers/agent-artifact.handler';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

describe('registerAgentArtifactHandlers', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('registers artifact runtime IPC handlers', () => {
    registerAgentArtifactHandlers({
      listByRun: vi.fn(),
      listBySession: vi.fn(),
      get: vi.fn(),
      getVersion: vi.fn(),
      createVersion: vi.fn(),
      updateStatus: vi.fn(),
      reference: vi.fn(),
    });

    expect(ipcMain.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.agent.artifacts.listByRun,
      expect.any(Function),
    );
    expect(ipcMain.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.agent.artifacts.reference,
      expect.any(Function),
    );
  });
});
