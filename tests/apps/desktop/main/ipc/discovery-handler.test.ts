/*
 * Protects the strict Recommendation IPC boundary, including local reads and explicit material actions.
 */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/desktop/main/ipc/channels';
import { registerDiscoveryHandlers } from '@megumi/desktop/main/ipc/handlers/discovery.handler';
import { RecommendationConfigurationSchema } from '@megumi/application/settings/definitions/recommendation';
const interest = {
  id: 'interest:1',
  text: 'Rust 异步运行时',
  enabled: true,
  revision: 1,
};
const configuration = {
  revision: 'v1',
  config: RecommendationConfigurationSchema.parse({}),
  sources: [],
};
describe('Recommendation IPC', () => {
  it('registers exactly the confirmed product operations without a legacy channel', () => {
    const handle = vi.fn();
    registerDiscoveryHandlers(
      { host: { recommendation: {} } as never },
      { ipcMain: { handle } as never },
    );

    expect(new Set(handle.mock.calls.map(([channel]) => channel))).toEqual(
      new Set(
        Object.values(IPC_CHANNELS.recommendation).filter(
          channel => channel !== IPC_CHANNELS.recommendation.changed,
        ),
      ),
    );
    expect(handle).toHaveBeenCalledTimes(17);
  });
  it('validates source IDs and forwards explicit login and access checks', async () => {
    const checkSourceAccess = vi.fn(async () => ({
      sourceId: 'xiaohongshu',
      state: 'login_required',
      checkedAt: '2026-10-07T00:00:00.000Z',
      retryAt: null,
      error: {
        code: 'LOGIN_REQUIRED',
        message: '需要登录',
      },
    }));
    const ipc = createIpc({
      openSourceLogin: async () => ({ status: 'opened' }),
      checkSourceAccess,
    });

    expect(
      await ipc.invoke(IPC_CHANNELS.recommendation.sourceLogin, { sourceId: 'xiaohongshu' }),
    ).toMatchObject({
      ok: true,
      data: { status: 'opened' },
    });
    expect(
      await ipc.invoke(IPC_CHANNELS.recommendation.sourceAccess, { sourceId: 'xiaohongshu' }),
    ).toMatchObject({
      ok: true,
      data: { state: 'login_required' },
    });
    expect(
      await ipc.invoke(IPC_CHANNELS.recommendation.sourceAccess, { sourceId: 'unknown' }),
    ).toMatchObject({
      ok: false,
      data: { code: 'ipc_invalid_request' },
    });
    expect(checkSourceAccess).toHaveBeenCalledOnce();
  });
  it('returns saved daily and curated results and an absent run without invoking generation', async () => {
    const feed = {
      date: '2026-10-07',
      items: [],
      batches: [],
      activeRuns: [],
    };
    const curated = {
      needsUpdate: false,
      supplyStatus: [],
    };
    const startCuratedSelection = vi.fn();
    const ipc = createIpc({
      listDailyFeed: async () => feed,
      getCuratedSelection: async () => curated,
      getRun: async () => undefined,
      startCuratedSelection,
    });

    expect(await ipc.invoke(IPC_CHANNELS.recommendation.listDailyFeed, {})).toMatchObject({
      ok: true,
      data: feed,
    });
    expect(await ipc.invoke(IPC_CHANNELS.recommendation.getCuratedSelection, {})).toMatchObject({
      ok: true,
      data: curated,
    });
    expect(
      await ipc.invoke(IPC_CHANNELS.recommendation.getRun, { runId: 'missing' }),
    ).toMatchObject({
      ok: true,
      data: undefined,
    });
    expect(startCuratedSelection).not.toHaveBeenCalled();
  });
  it('forwards separate interest edits and preserves public conflict codes', async () => {
    const updateInterest = vi.fn(async () => ({
      status: 'updated',
      interest: {
        ...interest,
        enabled: false,
      },
    }));
    const ipc = createIpc({
      listInterests: async () => ({ interests: [interest] }),
      updateInterest,

      deleteInterest: async () => {
        throw Object.assign(new Error('Changed'), { code: 'REVISION_CONFLICT' });
      },
    });

    expect(await ipc.invoke(IPC_CHANNELS.recommendation.interestList, {})).toMatchObject({
      ok: true,
      data: { interests: [interest] },
    });

    const request = {
      interestId: interest.id,
      expectedRevision: 1,
      enabled: false,
    };

    expect(await ipc.invoke(IPC_CHANNELS.recommendation.updateInterest, request)).toMatchObject({
      ok: true,
      data: {
        status: 'updated',
        interest: { enabled: false },
      },
    });
    expect(updateInterest).toHaveBeenCalledWith(request);
    expect(
      await ipc.invoke(IPC_CHANNELS.recommendation.updateInterest, {
        interestId: interest.id,
        expectedRevision: 1,
      }),
    ).toMatchObject({
      ok: false,
      data: { code: 'ipc_invalid_request' },
    });
    expect(
      await ipc.invoke(IPC_CHANNELS.recommendation.deleteInterest, {
        interestId: interest.id,
        expectedRevision: 1,
      }),
    ).toMatchObject({
      ok: false,
      data: { code: 'REVISION_CONFLICT' },
    });
  });
  it('forwards versioned configuration updates and rejects unknown fields before delegation', async () => {
    const updateConfiguration = vi.fn(async () => configuration);
    const ipc = createIpc({
      getConfiguration: async () => configuration,
      updateConfiguration,
    });

    expect(await ipc.invoke(IPC_CHANNELS.recommendation.configurationGet, {})).toMatchObject({
      ok: true,
      data: { revision: 'v1' },
    });

    const request = {
      expectedRevision: 'v1',
      changes: { enabled: true },
    };

    expect(
      await ipc.invoke(IPC_CHANNELS.recommendation.configurationUpdate, request),
    ).toMatchObject({ ok: true });
    expect(updateConfiguration).toHaveBeenCalledWith(request);
    expect(
      await ipc.invoke(IPC_CHANNELS.recommendation.configurationUpdate, {
        ...request,
        unexpected: true,
      }),
    ).toMatchObject({
      ok: false,
      data: { code: 'ipc_invalid_request' },
    });
    expect(updateConfiguration).toHaveBeenCalledOnce();
  });
  it('requires displayed material only for saving and opens a saved content identity', async () => {
    const setFavorite = vi.fn(async request => ({
      ...request,
      changed: true,
    }));
    const openContent = vi.fn(async () => ({ status: 'accepted' }));
    const ipc = createIpc({
      setFavorite,
      openContent,
    });

    expect(
      await ipc.invoke(IPC_CHANNELS.recommendation.setFavorite, {
        contentId: 'c',
        saved: true,
      }),
    ).toMatchObject({
      ok: false,
      data: { code: 'ipc_invalid_request' },
    });
    expect(
      await ipc.invoke(IPC_CHANNELS.recommendation.setFavorite, {
        contentId: 'c',
        saved: false,
        materialId: 'm',
      }),
    ).toMatchObject({
      ok: false,
      data: { code: 'ipc_invalid_request' },
    });
    expect(
      await ipc.invoke(IPC_CHANNELS.recommendation.openContent, { contentId: 'c' }),
    ).toMatchObject({
      ok: true,
      data: { status: 'accepted' },
    });
    expect(openContent).toHaveBeenCalledWith({ contentId: 'c' });
    expect(
      await ipc.invoke(IPC_CHANNELS.recommendation.openContent, {
        url: 'https://arbitrary.example.com',
      }),
    ).toMatchObject({
      ok: false,
      data: { code: 'ipc_invalid_request' },
    });
    expect(setFavorite).not.toHaveBeenCalled();
  });
});

/** Captures the actual handler registrations and sends a Renderer-shaped envelope. */
function createIpc(recommendation: Record<string, unknown>) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const handle = (channel: string, handler: (...args: unknown[]) => unknown) => {
    handlers.set(channel, handler);
  };
  registerDiscoveryHandlers(
    { host: { recommendation } as never },
    { ipcMain: { handle } as never },
  );

  return {
    invoke: (channel: string, payload: unknown) =>
      handlers.get(channel)?.(
        {},
        {
          requestId: 'transport:' + channel,
          payload,
          meta: {
            channel,
            createdAt: '2026-10-07T00:00:00.000Z',
            source: 'renderer',
          },
        },
      ),
  };
}
