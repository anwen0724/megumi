// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';

const { invoke, on, removeListener } = vi.hoisted(() => ({
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke,
    on,
    removeListener,
    removeAllListeners: vi.fn(),
  },
}));

function createRequest<const TChannel extends string, const TPayload extends Record<string, unknown>>(
  channel: TChannel,
  payload: TPayload,
  requestId = 'ipc-preload-request-1',
) {
  return {
    requestId,
    payload,
    meta: {
      channel,
      createdAt: '2026-05-12T00:00:00.000Z',
      source: 'renderer' as const,
    },
    context: {
      requestId,
      traceId: 'trace-preload-request-1',
      debugId: 'debug-preload-request-1',
      operationName: channel.replace(':', '.'),
      source: 'renderer' as const,
      createdAt: '2026-05-12T00:00:00.000Z',
    },
  };
}

describe('preload api', () => {
  beforeEach(() => {
    vi.resetModules();
    invoke.mockReset();
    on.mockReset();
    removeListener.mockReset();
  });

  it('exposes provider methods on shared IPC channels with runtime requests', async () => {
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc-channels');
    const { api } = await import('@megumi/desktop/preload/api');

    invoke.mockResolvedValue({
      ok: true,
      data: {},
      meta: { requestId: 'ipc-preload-request-1', channel: 'provider:list', handledAt: 'now' },
    });

    const listRequest = createRequest(IPC_CHANNELS.provider.list, {});
    const updateRequest = createRequest(IPC_CHANNELS.provider.update, { providerId: 'deepseek', enabled: false });
    const keyRequest = createRequest(IPC_CHANNELS.provider.setApiKey, {
      providerId: 'deepseek',
      apiKey: 'test-api-key-fixture',
    });
    const deleteRequest = createRequest(IPC_CHANNELS.provider.deleteApiKey, { providerId: 'deepseek' });

    await api.provider.list(listRequest);
    await api.provider.update(updateRequest);
    await api.provider.setApiKey(keyRequest);
    await api.provider.deleteApiKey(deleteRequest);

    expect(invoke).toHaveBeenNthCalledWith(1, IPC_CHANNELS.provider.list, listRequest);
    expect(invoke).toHaveBeenNthCalledWith(2, IPC_CHANNELS.provider.update, updateRequest);
    expect(invoke).toHaveBeenNthCalledWith(3, IPC_CHANNELS.provider.setApiKey, keyRequest);
    expect(invoke).toHaveBeenNthCalledWith(4, IPC_CHANNELS.provider.deleteApiKey, deleteRequest);
  });

  it('converts rejected provider invokes to ipc_invoke_failed results', async () => {
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc-channels');
    const { api } = await import('@megumi/desktop/preload/api');

    invoke.mockRejectedValue(new Error('Error invoking remote ' + 'method provider:list: stack trace sk-test-secret'));

    const result = await api.provider.list(createRequest(IPC_CHANNELS.provider.list, {}));

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'ipc_invoke_failed',
        message: 'Megumi could not reach the main process.',
        severity: 'error',
        retryable: true,
        source: 'preload',
        debugId: 'debug-preload-request-1',
      },
      meta: {
        requestId: 'ipc-preload-request-1',
        channel: IPC_CHANNELS.provider.list,
        traceId: 'trace-preload-request-1',
        debugId: 'debug-preload-request-1',
        operationName: 'provider.list',
      },
    });
    expect(JSON.stringify(result)).not.toContain('Error invoking remote ' + 'method');
    expect(JSON.stringify(result)).not.toContain('stack trace');
    expect(JSON.stringify(result)).not.toContain('sk-test-secret');
  });

  it('creates a debug id for rejected invokes when request context has no debug id', async () => {
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc-channels');
    const { api } = await import('@megumi/desktop/preload/api');
    const request = createRequest(IPC_CHANNELS.provider.list, {});
    const { debugId: _debugId, ...contextWithoutDebugId } = request.context;
    const requestWithoutDebugId = {
      ...request,
      context: contextWithoutDebugId,
    };

    invoke.mockRejectedValue(new Error('native failure'));

    const result = await api.provider.list(requestWithoutDebugId);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'ipc_invoke_failed',
        source: 'preload',
        debugId: expect.stringMatching(/^debug-/),
      },
      meta: {
        requestId: 'ipc-preload-request-1',
        channel: IPC_CHANNELS.provider.list,
        traceId: 'trace-preload-request-1',
        debugId: expect.stringMatching(/^debug-/),
        operationName: 'provider.list',
      },
    });
  });

  it('exposes session message, run event, and runtime event APIs without old chat or agent namespaces', async () => {
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc-channels');
    const { api } = await import('@megumi/desktop/preload/api');
    const sendPayload = {
      providerId: 'deepseek' as const,
      modelId: 'deepseek-v4-flash',
      createdAt: '2026-05-17T00:00:00.000Z',
      messages: [{
        id: 'message-1',
        role: 'user' as const,
        content: 'Hello Megumi',
        createdAt: '2026-05-17T00:00:00.000Z',
      }],
    };
    const sendRequest = createRequest(IPC_CHANNELS.session.message.send, sendPayload);
    const cancelRequest = createRequest(IPC_CHANNELS.session.message.cancel, {
      targetRequestId: 'ipc-preload-request-1',
    }, 'ipc-preload-cancel-1');
    const eventsRequest = createRequest(IPC_CHANNELS.run.events.list, {
      runId: 'run-1',
    }, 'ipc-run-events-list-1');
    const callback = vi.fn();

    invoke.mockResolvedValue({
      ok: true,
      data: {},
      meta: {
        requestId: 'ipc-preload-request-1',
        channel: IPC_CHANNELS.session.message.send,
        handledAt: 'now',
      },
    });

    await api.session.message.send(sendRequest);
    await api.session.message.cancel(cancelRequest);
    await api.run.events.list(eventsRequest);
    const unsubscribe = api.runtime.onEvent(callback);

    expect('chat' in api).toBe(false);
    expect('agent' in api).toBe(false);
    expect(invoke).toHaveBeenNthCalledWith(1, IPC_CHANNELS.session.message.send, sendRequest);
    expect(invoke).toHaveBeenNthCalledWith(2, IPC_CHANNELS.session.message.cancel, cancelRequest);
    expect(invoke).toHaveBeenNthCalledWith(3, IPC_CHANNELS.run.events.list, eventsRequest);
    expect(on).toHaveBeenCalledWith(IPC_CHANNELS.runtime.event, expect.any(Function));

    const listener = on.mock.calls[0][1];
    const runtimeEvent: RuntimeEvent = {
      eventId: 'event-1',
      schemaVersion: 1,
      eventType: 'assistant.output.delta',
      requestId: 'request-1',
      runId: 'run-1',
      sequence: 1,
      createdAt: '2026-05-12T10:00:00.000Z',
      source: 'provider',
      visibility: 'user',
      persist: 'transient',
      payload: { delta: 'Hi' },
    };
    listener({}, runtimeEvent);
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'assistant.output.delta',
    }));

    unsubscribe();
    expect(removeListener).toHaveBeenCalledWith(IPC_CHANNELS.runtime.event, listener);
  });

  it('does not expose old chat or agent preload namespaces in source', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const source = readFileSync(join(process.cwd(), 'apps/desktop/src/preload/api.ts'), 'utf8');

    expect(source).not.toMatch(/\bchat:\s*\{/);
    expect(source).not.toMatch(/\bagent:\s*\{/);
    expect(source).not.toContain(['IPC_CHANNELS', 'chat'].join('.'));
    expect(source).not.toContain(['IPC_CHANNELS', 'agent'].join('.'));
  });

  it('keeps window controls as lightweight shell ipc', async () => {
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc-channels');
    const { api } = await import('@megumi/desktop/preload/api');

    invoke.mockResolvedValue(undefined);

    await api.windowControls.minimize();
    await api.windowControls.toggleMaximize();
    await api.windowControls.close();

    expect(invoke).toHaveBeenNthCalledWith(1, IPC_CHANNELS.window.minimize);
    expect(invoke).toHaveBeenNthCalledWith(2, IPC_CHANNELS.window.toggleMaximize);
    expect(invoke).toHaveBeenNthCalledWith(3, IPC_CHANNELS.window.close);
  });
});
