/* Protects the strict Desktop IPC boundary for Trace diagnostics and lazy Content reads. */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/desktop/main/ipc/channels';
import { registerObservabilityHandlers } from '@megumi/desktop/main/ipc/handlers/observability.handler';

describe('registerObservabilityHandlers', () => {
  it('registers every Trace diagnostics operation and forwards trace identity', async () => {
    const handlers = handlerMap();
    const getTrace = vi.fn(async () => ({ status: 'not_found' as const }));
    registerObservabilityHandlers(
      { host: { observability: { getTrace } } as never },
      { ipcMain: handlers.ipcMain as never },
    );

    expect([...handlers.values.keys()]).toEqual([
      IPC_CHANNELS.observability.list,
      IPC_CHANNELS.observability.get,
      IPC_CHANNELS.observability.content,
      IPC_CHANNELS.observability.health,
      IPC_CHANNELS.observability.rebuildIndex,
      IPC_CHANNELS.observability.legacy,
      IPC_CHANNELS.observability.bundle,
    ]);

    const response = await handlers.values.get(IPC_CHANNELS.observability.get)?.(
      {},
      request(IPC_CHANNELS.observability.get, { traceId: 'trace:1' }),
    );
    expect(getTrace).toHaveBeenCalledWith({ traceId: 'trace:1' });
    expect(response).toMatchObject({ ok: true, data: { status: 'not_found' } });
  });

  it('rejects invalid Content payloads and logs only sanitized validation issues', async () => {
    const handlers = handlerMap();
    const getContent = vi.fn();
    const warn = vi.fn();
    registerObservabilityHandlers(
      { host: { observability: { getContent } } as never },
      { ipcMain: handlers.ipcMain as never, logger: { warn } as never },
    );

    const response = await handlers.values.get(IPC_CHANNELS.observability.content)?.(
      {},
      request(IPC_CHANNELS.observability.content, {
        traceId: 'trace:1', sequence: -1, credential: 'do-not-log-me',
      }),
    );

    expect(getContent).not.toHaveBeenCalled();
    expect(response).toMatchObject({ ok: false, data: { code: 'ipc_invalid_request' } });
    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('do-not-log-me');
  });
});

function handlerMap() {
  const values = new Map<string, (...args: unknown[]) => unknown>();
  return {
    values,
    ipcMain: {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
        values.set(channel, handler);
      },
    },
  };
}

function request(channel: string, payload: unknown) {
  return {
    requestId: `request:${channel}`,
    payload,
    meta: { channel, createdAt: '2026-08-26T10:00:00.000Z', source: 'renderer' },
  };
}
