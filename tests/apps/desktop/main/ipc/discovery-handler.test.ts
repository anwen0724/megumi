/* Protects the strict Desktop IPC boundary for Discovery interests and Candidate Supply. */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/desktop/main/ipc/channels';
import { registerDiscoveryHandlers } from '@megumi/desktop/main/ipc/handlers/discovery.handler';

const interest = { id: 'interest:1', text: 'Rust 异步运行时', enabled: true, revision: 1 };
const configuration = {
  candidateSupplyConfirmed: false,
  sources: [{ sourceId: 'zhihu', name: 'Zhihu', enabled: true, credentialConfigured: false }],
};

describe('registerDiscoveryHandlers', () => {
  it('registers exactly the retained Discovery channels', () => {
    const handle = vi.fn();

    registerDiscoveryHandlers(
      { host: { discovery: {} } as never },
      { ipcMain: { handle } as never },
    );

    expect(handle.mock.calls.map(([channel]) => channel)).toEqual([
      IPC_CHANNELS.discovery.interestList,
      IPC_CHANNELS.discovery.interestChange,
      IPC_CHANNELS.discovery.configurationGet,
      IPC_CHANNELS.discovery.configurationUpdate,
      IPC_CHANNELS.discovery.candidateSupplyConfirm,
    ]);
  });

  it('forwards interest reads and edits through the Product Host', async () => {
    const listInterests = vi.fn(async () => ({ interests: [interest] }));
    const changeInterest = vi.fn(async () => ({
      status: 'changed' as const,
      interests: [{ ...interest, enabled: false }],
    }));
    const ipc = createDiscoveryIpc({ listInterests, changeInterest });

    expect(await ipc.invoke(IPC_CHANNELS.discovery.interestList, {})).toMatchObject({
      ok: true,
      data: { interests: [interest] },
    });
    expect(listInterests).toHaveBeenCalledOnce();

    const changed = await ipc.invoke(IPC_CHANNELS.discovery.interestChange, {
      action: 'pause',
      interestId: 'interest:1', expectedRevision: 1,
    });

    expect(changeInterest).toHaveBeenCalledWith({ action: 'pause', interestId: 'interest:1', expectedRevision: 1 });
    expect(changed).toMatchObject({
      ok: true,
      data: { status: 'changed', interests: [{ enabled: false }] },
    });
  });

  it('forwards the supply configuration read, update, and confirmation', async () => {
    const getConfiguration = vi.fn(async () => configuration);
    const updateConfiguration = vi.fn(async () => ({
      ...configuration,
      candidateSupplyConfirmed: true,
    }));
    const confirmCandidateSupply = vi.fn(async () => ({ status: 'confirmed' as const }));
    const ipc = createDiscoveryIpc({
      getConfiguration,
      updateConfiguration,
      confirmCandidateSupply,
    });

    expect(await ipc.invoke(IPC_CHANNELS.discovery.configurationGet, {})).toMatchObject({
      ok: true,
      data: { sources: [{ sourceId: 'zhihu' }] },
    });
    expect(getConfiguration).toHaveBeenCalledOnce();

    const updated = await ipc.invoke(IPC_CHANNELS.discovery.configurationUpdate, {
      enabledSources: ['zhihu'],
    });

    expect(updateConfiguration).toHaveBeenCalledWith({ enabledSources: ['zhihu'] });
    expect(updated).toMatchObject({ ok: true, data: { candidateSupplyConfirmed: true } });

    expect(await ipc.invoke(IPC_CHANNELS.discovery.candidateSupplyConfirm, {})).toMatchObject({
      ok: true,
      data: { status: 'confirmed' },
    });
    expect(confirmCandidateSupply).toHaveBeenCalledOnce();
  });

  it('rejects unknown payload fields before calling the Product Host', async () => {
    const confirmCandidateSupply = vi.fn();
    const ipc = createDiscoveryIpc({ confirmCandidateSupply });

    const response = await ipc.invoke(IPC_CHANNELS.discovery.candidateSupplyConfirm, {
      unexpected: true,
    });

    expect(confirmCandidateSupply).not.toHaveBeenCalled();
    expect(response).toMatchObject({ ok: false, data: { code: 'ipc_invalid_request' } });
  });

  it('rejects an interest edit that omits the fields its action requires', async () => {
    const changeInterest = vi.fn();
    const ipc = createDiscoveryIpc({ changeInterest });

    const response = await ipc.invoke(IPC_CHANNELS.discovery.interestChange, {
      action: 'update',
      interestId: 'interest:1', expectedRevision: 1,
    });

    expect(changeInterest).not.toHaveBeenCalled();
    expect(response).toMatchObject({ ok: false, data: { code: 'ipc_invalid_request' } });
  });
});

/** Captures the installed handlers and invokes one the way the Renderer submits a request. */
function createDiscoveryIpc(discovery: Record<string, unknown>) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const handle = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    handlers.set(channel, handler);
  });
  registerDiscoveryHandlers({ host: { discovery } as never }, { ipcMain: { handle } as never });

  return {
    invoke: (channel: string, payload: unknown) =>
      handlers.get(channel)?.({}, request(channel, payload)),
  };
}

function request(channel: string, payload: unknown) {
  return {
    requestId: `request:${channel}`,
    payload,
    meta: { channel, createdAt: '2026-08-22T10:00:00.000Z', source: 'renderer' },
  };
}
