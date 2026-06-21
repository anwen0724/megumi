// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/shared/ipc';
import { DEFAULT_APP_SETTINGS } from '@megumi/shared/settings';
import { registerSettingsHandlers } from '@megumi/desktop/main/ipc/handlers/settings.handler';
import { ipcOperationNameFromChannel } from '@megumi/desktop/main/ipc/ipc-operation-name';

function createRequest(channel: string, payload: Record<string, unknown>, requestId = 'request:settings') {
  return {
    requestId,
    payload,
    meta: {
      channel,
      createdAt: '2026-06-13T00:00:00.000Z',
      source: 'renderer',
    },
  };
}

describe('registerSettingsHandlers', () => {
  it('registers settings get and update handlers', () => {
    const ipcMain = { handle: vi.fn() };
    const service = {
      getResolvedSettings: vi.fn(() => DEFAULT_APP_SETTINGS),
      updateSettings: vi.fn(() => DEFAULT_APP_SETTINGS),
    };

    registerSettingsHandlers({ ipcMain: ipcMain as any, settingsService: service });

    expect(ipcMain.handle).toHaveBeenCalledWith(IPC_CHANNELS.settings.get, expect.any(Function));
    expect(ipcMain.handle).toHaveBeenCalledWith(IPC_CHANNELS.settings.update, expect.any(Function));
  });

  it('returns resolved settings and updates with sparse raw patch', async () => {
    const handlers = new Map<string, (...args: any[]) => Promise<unknown>>();
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (...args: any[]) => Promise<unknown>) => {
        handlers.set(channel, handler);
      }),
    };
    const updated = {
      ...DEFAULT_APP_SETTINGS,
      theme: 'graphite-dark' as const,
      memory: {
        enabled: true,
      },
    };
    const service = {
      getResolvedSettings: vi.fn(() => DEFAULT_APP_SETTINGS),
      updateSettings: vi.fn(() => updated),
    };

    registerSettingsHandlers({ ipcMain: ipcMain as any, settingsService: service });

    const getResult = await handlers.get(IPC_CHANNELS.settings.get)?.(
      {} as any,
      createRequest(IPC_CHANNELS.settings.get, {}, 'request:settings:get'),
    );
    expect(service.getResolvedSettings).toHaveBeenCalledWith();
    expect(getResult).toMatchObject({
      ok: true,
      data: {
        settings: DEFAULT_APP_SETTINGS,
      },
    });

    const patch = {
      theme: 'graphite-dark',
      memory: {
        enabled: true,
      },
    } as const;
    const updateResult = await handlers.get(IPC_CHANNELS.settings.update)?.(
      {} as any,
      createRequest(IPC_CHANNELS.settings.update, patch, 'request:settings:update'),
    );
    expect(service.updateSettings).toHaveBeenCalledWith(patch);
    expect(updateResult).toMatchObject({
      ok: true,
      data: {
        settings: updated,
      },
    });
  });

  it('exposes operation names for settings IPC', () => {
    expect(ipcOperationNameFromChannel(IPC_CHANNELS.settings.get)).toBe('settings.get');
    expect(ipcOperationNameFromChannel(IPC_CHANNELS.settings.update)).toBe('settings.update');
  });
});
