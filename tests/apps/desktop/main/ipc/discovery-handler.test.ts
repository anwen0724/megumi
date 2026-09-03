/* Protects the strict Desktop IPC boundary for Recommendation operations. */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/desktop/main/ipc/channels';
import { registerDiscoveryHandlers } from '@megumi/desktop/main/ipc/handlers/discovery.handler';

describe('registerDiscoveryHandlers', () => {
  it('forwards a valid Recommendation request through the Product Host', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const handle = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    });
    const requestRecommendation = vi.fn(async () => ({
      status: 'started' as const,
      localDate: '2026-08-22',
      requestId: 'request:discovery:1',
      executionId: 'execution:1',
    }));

    registerDiscoveryHandlers(
      { host: { discovery: { requestRecommendation } } as never },
      { ipcMain: { handle } as never },
    );

    const response = await handlers.get(IPC_CHANNELS.discovery.recommendationRequest)?.({}, {
      requestId: 'request:discovery:1',
      payload: { trigger: 'manual' },
      meta: {
        channel: IPC_CHANNELS.discovery.recommendationRequest,
        createdAt: '2026-08-22T10:00:00.000Z',
        source: 'renderer',
      },
    });

    expect(requestRecommendation).toHaveBeenCalledWith({
      trigger: 'manual',
    });
    expect(response).toMatchObject({
      ok: true,
      data: {
        status: 'started',
        localDate: '2026-08-22',
        requestId: 'request:discovery:1',
        executionId: 'execution:1',
      },
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

  it('refreshes every source through one configuration projection', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const refreshSources = vi.fn(async () => ({
      conversationRecognitionEnabled: true,
      recommendationGenerationTime: '08:00',
      recommendationTargetCount: 20,
      recommendationWorkingSetCount: 80,
      candidatePoolMinimumCount: 100,
      candidatePoolMaximumCount: 200,
      candidateValidityDays: 30,
      candidateContentExcerptMaxCharacters: 8_000,
      candidateSupplyCheckIntervalMinutes: 360,
      sources: [],
    }));
    registerDiscoveryHandlers(
      { host: { discovery: { refreshSources } } as never },
      { ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler); } } as never },
    );

    const response = await handlers.get(IPC_CHANNELS.discovery.sourcesRefresh)?.({}, request(
      IPC_CHANNELS.discovery.sourcesRefresh, {},
    ));

    expect(refreshSources).toHaveBeenCalledOnce();
    expect(response).toMatchObject({ ok: true, data: { sources: [] } });
  });
});

function request(channel: string, payload: unknown) {
  return {
    requestId: `request:${channel}`,
    payload,
    meta: { channel, createdAt: '2026-08-22T10:00:00.000Z', source: 'renderer' },
  };
}
