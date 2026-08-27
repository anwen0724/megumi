/*
 * Verifies update IPC commands validate inputs and delegate only finite user operations.
 */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/desktop/main/ipc/channels';
import { registerApplicationUpdateHandlers } from '@megumi/desktop/main/ipc/handlers/application-update.handler';

describe('Application update IPC handler', () => {
  it('registers the complete update command surface and validates boolean preferences', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const handle = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    });
    const controller = {
      getSnapshot: vi.fn(() => ({ status: 'idle' })),
      checkNow: vi.fn(),
      setAutomaticChecksEnabled: vi.fn(),
      setAutomaticDownloadsEnabled: vi.fn(),
      downloadUpdate: vi.fn(),
      restartAndInstall: vi.fn(),
      openReleasePage: vi.fn(),
    };

    registerApplicationUpdateHandlers({ controller: controller as never, ipcMain: { handle } });
    await handlers.get(IPC_CHANNELS.applicationUpdate.automaticChecksSet)?.({}, { enabled: false });
    await handlers.get(IPC_CHANNELS.applicationUpdate.automaticDownloadsSet)?.({}, { enabled: true });
    await handlers.get(IPC_CHANNELS.applicationUpdate.releasePageOpen)?.({});

    expect(controller.setAutomaticChecksEnabled).toHaveBeenCalledWith(false);
    expect(controller.setAutomaticDownloadsEnabled).toHaveBeenCalledWith(true);
    expect(controller.openReleasePage).toHaveBeenCalledOnce();
    expect(() => handlers.get(IPC_CHANNELS.applicationUpdate.automaticChecksSet)?.({}, { enabled: 'no' }))
      .toThrow();
    expect(handle).toHaveBeenCalledTimes(7);
  });
});
