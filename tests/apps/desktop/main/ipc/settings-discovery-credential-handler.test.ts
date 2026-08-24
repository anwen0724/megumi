/* Protects the write-only Desktop IPC boundary for discovery credentials. */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/desktop/main/ipc/channels';
import { registerSettingsHandlers } from '@megumi/desktop/main/ipc/handlers/settings.handler';

describe('discovery credential Settings IPC', () => {
  it('forwards save and status requests while returning only configured state', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const getDiscoverySourceCredentialStatus = vi.fn(async () => ({
      status: 'ok' as const, sourceId: 'twitter' as const, configured: true,
    }));
    const setDiscoverySourceCredential = vi.fn(async () => ({
      status: 'ok' as const, sourceId: 'twitter' as const, configured: true,
    }));
    registerSettingsHandlers(
      { host: { settings: { getDiscoverySourceCredentialStatus, setDiscoverySourceCredential } } as never },
      { ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler); } } as never },
    );

    const saved = await handlers.get(IPC_CHANNELS.settings.discoveryCredentialSet)?.({}, request(
      IPC_CHANNELS.settings.discoveryCredentialSet,
      { sourceId: 'twitter', credential: 'twitter-secret' },
    ));
    const status = await handlers.get(IPC_CHANNELS.settings.discoveryCredentialGet)?.({}, request(
      IPC_CHANNELS.settings.discoveryCredentialGet,
      { sourceId: 'twitter' },
    ));

    expect(setDiscoverySourceCredential).toHaveBeenCalledWith({
      sourceId: 'twitter', credential: 'twitter-secret',
    });
    expect(JSON.stringify(saved)).not.toContain('twitter-secret');
    expect(status).toMatchObject({ ok: true, data: { configured: true } });
  });
});

function request(channel: string, payload: unknown) {
  return {
    requestId: `request:${channel}`,
    payload,
    meta: { channel, createdAt: '2026-08-22T10:00:00.000Z', source: 'renderer' },
  };
}
