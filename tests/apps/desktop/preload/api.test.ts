// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatStreamEvent } from '@megumi/shared/chat-stream';
import type { RuntimeEvent } from '@megumi/shared/runtime';

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
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc');
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

  it('exposes app settings methods on shared IPC channels with runtime requests', async () => {
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc');
    const { api } = await import('@megumi/desktop/preload/api');

    invoke.mockResolvedValue({
      ok: true,
      data: {
        settings: {
          theme: 'midnight-blue',
          memory: {
            enabled: false,
          },
          compaction: {
            enabled: true,
            reserveTokens: 16384,
            keepRecentTokens: 20000,
          },
        },
      },
      meta: { requestId: 'ipc-preload-request-1', channel: IPC_CHANNELS.settings.get, handledAt: 'now' },
    });

    const getRequest = createRequest(IPC_CHANNELS.settings.get, {});
    const updateRequest = createRequest(IPC_CHANNELS.settings.update, {
      theme: 'graphite-dark',
      memory: {
        enabled: true,
      },
    });

    await api.settings.get(getRequest);
    await api.settings.update(updateRequest);

    expect(invoke).toHaveBeenNthCalledWith(1, IPC_CHANNELS.settings.get, getRequest);
    expect(invoke).toHaveBeenNthCalledWith(2, IPC_CHANNELS.settings.update, updateRequest);
  });

  it('converts rejected provider invokes to ipc_invoke_failed results', async () => {
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc');
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
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc');
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

  it('exposes session message, run event, runtime event, and chat stream APIs without old chat or agent namespaces', async () => {
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc');
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
    const chatStreamCallback = vi.fn();

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
    const unsubscribeChatStream = api.chatStream.onEvent(chatStreamCallback);

    expect('chat' in api).toBe(false);
    expect('agent' in api).toBe(false);
    expect(invoke).toHaveBeenNthCalledWith(1, IPC_CHANNELS.session.message.send, sendRequest);
    expect(invoke).toHaveBeenNthCalledWith(2, IPC_CHANNELS.session.message.cancel, cancelRequest);
    expect(invoke).toHaveBeenNthCalledWith(3, IPC_CHANNELS.run.events.list, eventsRequest);
    expect(on).toHaveBeenCalledWith(IPC_CHANNELS.runtime.event, expect.any(Function));
    expect(on).toHaveBeenCalledWith(IPC_CHANNELS.chatStream.event, expect.any(Function));

    const listener = on.mock.calls[0][1];
    const chatStreamListener = on.mock.calls[1][1];
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
    const chatStreamEvent: ChatStreamEvent = {
      eventId: 'chat-event-1',
      eventType: 'assistant.text.delta',
      projectId: 'project-1',
      sessionId: 'session-1',
      runId: 'run-1',
      streamId: 'stream-1',
      streamKind: 'main',
      seq: 1,
      createdAt: '2026-05-24T00:00:00.000Z',
      textId: 'text-1',
      phase: 'answer',
      delta: 'Hi',
    };
    chatStreamListener({}, chatStreamEvent);
    expect(chatStreamCallback).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'assistant.text.delta',
      delta: 'Hi',
    }));

    unsubscribe();
    unsubscribeChatStream();
    expect(removeListener).toHaveBeenCalledWith(IPC_CHANNELS.runtime.event, listener);
    expect(removeListener).toHaveBeenCalledWith(IPC_CHANNELS.chatStream.event, chatStreamListener);
  });

  it('exposes session.timeline.list through the typed preload API', async () => {
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc');
    const { api } = await import('@megumi/desktop/preload/api');
    const request = createRequest(IPC_CHANNELS.session.timeline.list, {
      projectId: 'project-1',
      sessionId: 'session-1',
    });

    await api.session.timeline.list(request);

    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.session.timeline.list, request);
  });

  it('does not expose old chat or agent preload namespaces in source', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const source = readFileSync(join(process.cwd(), 'apps/desktop/src/preload/api.ts'), 'utf8');

    expect(source).not.toMatch(/\bchat:\s*\{/);
    expect(source).not.toMatch(/\bagent:\s*\{/);
    expect(source).not.toMatch(/\bIPC_CHANNELS\.chat\./);
    expect(source).not.toContain(['IPC_CHANNELS', 'agent'].join('.'));
  });

  it('invokes project runtime IPC channels through preload API', async () => {
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc');
    const { api } = await import('@megumi/desktop/preload/api');

    invoke.mockResolvedValue({
      ok: true,
      data: { projects: [] },
      meta: { requestId: 'ipc-preload-project-list-1', channel: IPC_CHANNELS.project.list, handledAt: 'now' },
    });

    const listRequest = createRequest(IPC_CHANNELS.project.list, {});

    await api.project.list(listRequest);

    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.project.list, listRequest);
  });

  it('keeps window controls as lightweight shell ipc', async () => {
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc');
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

