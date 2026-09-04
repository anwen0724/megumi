/* Protects fixed-path settings recovery commands and their IPC validation. */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import { registerSettingsRecoveryHandlers } from '@megumi/desktop/main/ipc/handlers/settings-recovery.handler';
import { IPC_CHANNELS } from '@megumi/desktop/main/ipc/channels';

describe('settings recovery IPC', () => {
  it('returns only the trusted path and rejects renderer-supplied paths', async () => {
    const handlers = new Map<string, (event: IpcMainInvokeEvent, payload: unknown) => unknown>();
    const openDirectory = vi.fn(async () => undefined);
    const restart = vi.fn(async () => undefined);
    registerSettingsRecoveryHandlers({ settingsPath: 'C:/home/settings.json', openDirectory, restart }, {
      ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler); }, on: vi.fn() },
    });
    const invoke = (channel: string, payload: object = {}) => handlers.get(channel)?.({} as IpcMainInvokeEvent, {
      requestId: 'test:settings-recovery', payload, meta: { channel, createdAt: new Date().toISOString(), source: 'renderer' },
    });
    expect(await invoke(IPC_CHANNELS.settingsRecovery.get)).toMatchObject({ ok: true, data: { settingsPath: 'C:/home/settings.json' } });
    expect(await invoke(IPC_CHANNELS.settingsRecovery.openDirectory, { path: 'C:/other' })).toMatchObject({ ok: false });
    expect(openDirectory).not.toHaveBeenCalled();
    expect(await invoke(IPC_CHANNELS.settingsRecovery.openDirectory)).toMatchObject({ ok: true });
    expect(openDirectory).toHaveBeenCalledExactlyOnceWith();
    expect(await invoke(IPC_CHANNELS.settingsRecovery.restart)).toMatchObject({ ok: true });
    expect(restart).toHaveBeenCalledOnce();
    restart.mockRejectedValue(new Error('SECRET_DETAIL'));
    const failed = await invoke(IPC_CHANNELS.settingsRecovery.restart);
    expect(failed).toMatchObject({ ok: false, data: { code: 'ipc_handler_failed' } });
    expect(JSON.stringify(failed)).not.toContain('SECRET_DETAIL');
  });
});
