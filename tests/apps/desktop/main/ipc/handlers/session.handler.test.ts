// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';

const { handle } = vi.hoisted(() => ({
  handle: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: { handle },
}));

function createRequest(channel: string, payload: Record<string, unknown>, requestId = 'ipc-session-message-send-1') {
  return {
    requestId,
    payload,
    meta: {
      channel,
      createdAt: '2026-05-17T00:00:00.000Z',
      source: 'renderer',
    },
    context: {
      requestId,
      traceId: `trace-${requestId}`,
      debugId: `debug-${requestId}`,
      operationName: channel === 'session:message:send' ? 'session.message.send' : 'session.message.cancel',
      source: 'renderer',
      createdAt: '2026-05-17T00:00:00.000Z',
    },
  };
}

function createSessionMessageSendPayload() {
  return {
    sessionId: 'session-1',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    createdAt: '2026-05-17T00:00:00.000Z',
    messages: [
      {
        id: 'message-1',
        role: 'user',
        content: 'Hello',
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    ],
  };
}

describe('registerSessionHandlers', () => {
  beforeEach(() => {
    vi.resetModules();
    handle.mockReset();
  });

  it('registers primary session IPC handlers', async () => {
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc-channels');
    const { registerSessionHandlers } = await import('@megumi/desktop/main/ipc/handlers/session.handler');

    registerSessionHandlers({
      createSession: vi.fn(),
      listSessions: vi.fn(),
      sendSessionMessage: vi.fn(),
      cancelSessionMessage: vi.fn(),
    });

    expect(handle).toHaveBeenCalledWith(IPC_CHANNELS.session.create, expect.any(Function));
    expect(handle).toHaveBeenCalledWith(IPC_CHANNELS.session.list, expect.any(Function));
    expect(handle).toHaveBeenCalledWith(IPC_CHANNELS.session.message.send, expect.any(Function));
    expect(handle).toHaveBeenCalledWith(IPC_CHANNELS.session.message.cancel, expect.any(Function));
  });

  it('sends session messages and forwards runtime events', async () => {
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc-channels');
    const { registerSessionHandlers } = await import('@megumi/desktop/main/ipc/handlers/session.handler');
    const eventSender = { send: vi.fn() };
    const runtimeEvent = {
      eventId: 'event-1',
      schemaVersion: 1,
      eventType: 'assistant.output.delta',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      sequence: 1,
      createdAt: '2026-05-17T00:00:01.000Z',
      source: 'provider',
      visibility: 'user',
      persist: 'transient',
      payload: { delta: 'Hello' },
    } satisfies RuntimeEvent;
    const service = {
      createSession: vi.fn(),
      listSessions: vi.fn(),
      sendSessionMessage: vi.fn(async () => ({
        data: { requestId: 'ipc-session-message-send-1' },
        events: async function* () {
          yield runtimeEvent;
        }(),
      })),
      cancelSessionMessage: vi.fn(),
    };

    registerSessionHandlers(service);

    const handler = handle.mock.calls.find(([channel]) => channel === IPC_CHANNELS.session.message.send)?.[1];
    await expect(handler({ sender: eventSender }, createRequest(
      IPC_CHANNELS.session.message.send,
      createSessionMessageSendPayload(),
    ))).resolves.toMatchObject({
      ok: true,
      data: {
        requestId: 'ipc-session-message-send-1',
      },
      meta: {
        requestId: 'ipc-session-message-send-1',
        channel: IPC_CHANNELS.session.message.send,
      },
    });

    await vi.waitFor(() => {
      expect(eventSender.send).toHaveBeenCalledWith(IPC_CHANNELS.runtime.event, runtimeEvent);
    });
    expect(service.sendSessionMessage).toHaveBeenCalledWith({
      requestId: 'ipc-session-message-send-1',
      payload: createSessionMessageSendPayload(),
      runtimeContext: {
        requestId: 'ipc-session-message-send-1',
        traceId: 'trace-ipc-session-message-send-1',
        debugId: 'debug-ipc-session-message-send-1',
        operationName: 'session.message.send',
        source: 'renderer',
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    });
  });
});
