/* Protects the strict Desktop IPC boundary for daily discovery operations. */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/desktop/main/ipc/channels';
import { registerDiscoveryHandlers } from '@megumi/desktop/main/ipc/handlers/discovery.handler';

describe('registerDiscoveryHandlers', () => {
  it('forwards a valid daily discovery request through the Product Host', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const handle = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    });
    const ensureDaily = vi.fn(async () => ({
      status: 'no_active_interests' as const,
      localDate: '2026-08-22',
    }));

    registerDiscoveryHandlers(
      { host: { discovery: { ensureDaily } } as never },
      { ipcMain: { handle } as never },
    );

    const response = await handlers.get(IPC_CHANNELS.discovery.dailyEnsure)?.({}, {
      requestId: 'request:discovery:1',
      payload: { trigger: 'manual', now: '2026-08-22T10:00:00.000Z' },
      meta: {
        channel: IPC_CHANNELS.discovery.dailyEnsure,
        createdAt: '2026-08-22T10:00:00.000Z',
        source: 'renderer',
      },
    });

    expect(ensureDaily).toHaveBeenCalledWith({
      trigger: 'manual',
      now: '2026-08-22T10:00:00.000Z',
    });
    expect(response).toMatchObject({
      ok: true,
      data: { status: 'no_active_interests', localDate: '2026-08-22' },
    });
  });

  it('rejects unknown payload fields before calling the Product Host', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const handle = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    });
    const getHome = vi.fn();

    registerDiscoveryHandlers(
      { host: { discovery: { getHome } } as never },
      { ipcMain: { handle } as never },
    );

    const response = await handlers.get(IPC_CHANNELS.discovery.homeGet)?.({}, {
      requestId: 'request:discovery:invalid',
      payload: { mode: 'timeline', unexpected: true },
      meta: {
        channel: IPC_CHANNELS.discovery.homeGet,
        createdAt: '2026-08-22T10:00:00.000Z',
        source: 'renderer',
      },
    });

    expect(getHome).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      ok: false,
      data: { code: 'ipc_invalid_request' },
    });
  });

  it('forwards a browser source login request without platform-specific payloads', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const connectSource = vi.fn(async () => ({
      sourceId: 'xiaohongshu', name: '小红书', access: 'browser_session' as const,
      supportedModes: ['relevance' as const], supportsRead: true, enabled: true,
      connectionState: 'unknown' as const,
    }));
    registerDiscoveryHandlers(
      { host: { discovery: { connectSource } } as never },
      { ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler); } } as never },
    );

    const response = await handlers.get(IPC_CHANNELS.discovery.sourceConnect)?.({}, request(
      IPC_CHANNELS.discovery.sourceConnect, { sourceId: 'xiaohongshu' },
    ));

    expect(connectSource).toHaveBeenCalledWith({ sourceId: 'xiaohongshu' });
    expect(response).toMatchObject({ ok: true, data: { sourceId: 'xiaohongshu' } });
  });

  it('forwards an explicit source availability refresh', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const refreshSource = vi.fn(async () => ({
      sourceId: 'xiaohongshu', name: '小红书', access: 'browser_session' as const,
      supportedModes: ['relevance' as const], supportsRead: true, enabled: true,
      connectionState: 'ready' as const, checkedAt: '2026-08-26T08:00:00.000Z',
    }));
    registerDiscoveryHandlers(
      { host: { discovery: { refreshSource } } as never },
      { ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler); } } as never },
    );

    const response = await handlers.get(IPC_CHANNELS.discovery.sourceRefresh)?.({}, request(
      IPC_CHANNELS.discovery.sourceRefresh, { sourceId: 'xiaohongshu' },
    ));

    expect(refreshSource).toHaveBeenCalledWith({ sourceId: 'xiaohongshu' });
    expect(response).toMatchObject({ ok: true, data: { connectionState: 'ready' } });
  });
});

function request(channel: string, payload: unknown) {
  return {
    requestId: `request:${channel}`,
    payload,
    meta: { channel, createdAt: '2026-08-22T10:00:00.000Z', source: 'renderer' },
  };
}
