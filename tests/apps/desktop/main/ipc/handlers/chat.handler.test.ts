// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';

const { handle } = vi.hoisted(() => ({
  handle: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: { handle },
}));

function createRequest(channel: string, payload: Record<string, unknown>, requestId = 'ipc-chat-request-1') {
  return {
    requestId,
    payload,
    meta: {
      channel,
      createdAt: '2026-05-12T00:00:00.000Z',
      source: 'renderer',
    },
  };
}

function createChatStartPayload() {
  return {
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    createdAt: '2026-05-12T00:00:00.000Z',
    messages: [
      {
        id: 'message-1',
        role: 'user',
        content: 'Hello',
        createdAt: '2026-05-12T00:00:00.000Z',
      },
    ],
  };
}

describe('registerChatHandlers', () => {
  beforeEach(() => {
    vi.resetModules();
    handle.mockReset();
  });

  it('registers chat IPC handlers', async () => {
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc-channels');
    const { registerChatHandlers } = await import('@megumi/desktop/main/ipc/handlers/chat.handler');

    registerChatHandlers({
      streamChat: vi.fn(),
      cancelChat: vi.fn(),
    });

    expect(handle).toHaveBeenCalledWith(IPC_CHANNELS.chat.start, expect.any(Function));
    expect(handle).toHaveBeenCalledWith(IPC_CHANNELS.chat.cancel, expect.any(Function));
  });

  it('starts chat stream from runtime envelope and forwards runtime events unchanged', async () => {
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc-channels');
    const { registerChatHandlers } = await import('@megumi/desktop/main/ipc/handlers/chat.handler');
    const eventSender = { send: vi.fn() };
    const streamEvents: RuntimeEvent[] = [
      {
        eventId: 'event-1',
        schemaVersion: 1,
        eventType: 'run.started',
        requestId: 'ipc-chat-request-1',
        runId: 'run-1',
        sequence: 1,
        createdAt: '2026-05-12T00:00:01.000Z',
        source: 'core',
        visibility: 'system',
        persist: 'required',
        payload: {
          providerId: 'deepseek',
          modelId: 'deepseek-v4-flash',
          runKind: 'chat',
        },
      },
      {
        eventId: 'event-2',
        schemaVersion: 1,
        eventType: 'assistant.output.delta',
        requestId: 'ipc-chat-request-1',
        runId: 'run-1',
        sequence: 2,
        createdAt: '2026-05-12T00:00:02.000Z',
        source: 'provider',
        visibility: 'user',
        persist: 'transient',
        payload: {
          delta: 'Hello',
        },
      },
    ];
    const service = {
      streamChat: vi.fn(async function* () {
        yield* streamEvents;
      }),
      cancelChat: vi.fn(),
    };

    registerChatHandlers(service);

    const handler = handle.mock.calls.find(([channel]) => channel === IPC_CHANNELS.chat.start)?.[1];
    await expect(handler({ sender: eventSender }, createRequest(
      IPC_CHANNELS.chat.start,
      createChatStartPayload(),
    ))).resolves.toMatchObject({
      ok: true,
      data: {
        requestId: 'ipc-chat-request-1',
      },
      meta: {
        requestId: 'ipc-chat-request-1',
        channel: IPC_CHANNELS.chat.start,
      },
    });

    await vi.waitFor(() => {
      expect(eventSender.send).toHaveBeenCalledTimes(2);
    });

    expect(service.streamChat).toHaveBeenCalledWith({
      ...createChatStartPayload(),
      requestId: 'ipc-chat-request-1',
    });
    expect(eventSender.send).toHaveBeenCalledWith(IPC_CHANNELS.runtime.event, expect.objectContaining({
      eventType: 'run.started',
    }));
    expect(eventSender.send).toHaveBeenCalledWith(IPC_CHANNELS.runtime.event, streamEvents[1]);
  });

  it('rejects invalid chat start requests before streaming', async () => {
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc-channels');
    const { registerChatHandlers } = await import('@megumi/desktop/main/ipc/handlers/chat.handler');
    const service = {
      streamChat: vi.fn(),
      cancelChat: vi.fn(),
    };

    registerChatHandlers(service);

    const handler = handle.mock.calls.find(([channel]) => channel === IPC_CHANNELS.chat.start)?.[1];
    const result = await handler({ sender: { send: vi.fn() } }, createRequest(
      IPC_CHANNELS.chat.start,
      {
        ...createChatStartPayload(),
        providerId: 'not-a-provider',
      },
    ));

    expect(service.streamChat).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('ipc_invalid_request');
  });

  it('cancels chat requests by target request id', async () => {
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc-channels');
    const { registerChatHandlers } = await import('@megumi/desktop/main/ipc/handlers/chat.handler');
    const service = {
      streamChat: vi.fn(),
      cancelChat: vi.fn().mockReturnValue(true),
    };

    registerChatHandlers(service);

    const handler = handle.mock.calls.find(([channel]) => channel === IPC_CHANNELS.chat.cancel)?.[1];
    await expect(handler({}, createRequest(IPC_CHANNELS.chat.cancel, {
      targetRequestId: 'ipc-chat-request-1',
    }, 'ipc-chat-cancel-1'))).resolves.toMatchObject({
      ok: true,
      data: {
        cancelled: true,
      },
      meta: {
        requestId: 'ipc-chat-cancel-1',
        channel: IPC_CHANNELS.chat.cancel,
      },
    });
    expect(service.cancelChat).toHaveBeenCalledWith('ipc-chat-request-1');
  });

  it('returns a safe error envelope when chat start fails before streaming', async () => {
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc-channels');
    const { registerChatHandlers } = await import('@megumi/desktop/main/ipc/handlers/chat.handler');
    const service = {
      streamChat: vi.fn(() => {
        throw new Error('Provider stack leaked.');
      }),
      cancelChat: vi.fn(),
    };

    registerChatHandlers(service);

    const handler = handle.mock.calls.find(([channel]) => channel === IPC_CHANNELS.chat.start)?.[1];
    const result = await handler({ sender: { send: vi.fn() } }, createRequest(
      IPC_CHANNELS.chat.start,
      createChatStartPayload(),
    ));

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'ipc_handler_failed',
        message: 'Chat service failed.',
        severity: 'error',
        retryable: true,
        source: 'main',
      },
    });
    expect(JSON.stringify(result)).not.toContain('Provider stack leaked.');
  });
});
