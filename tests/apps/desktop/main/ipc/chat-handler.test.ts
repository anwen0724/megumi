/*
 * Verifies chat IPC handler ordering for run-scoped runtime event streaming.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/desktop/main/ipc/channels';
import {
  registerChatHandlers,
  type ChatHandlersService,
  type RegisterChatHandlersOptions,
} from '@megumi/desktop/main/ipc/handlers/chat.handler';
import type { RuntimeIpcRequest } from '@megumi/desktop/main/ipc/contracts';
import type { SessionContextUsageGetPayload, SessionMessageSendPayload } from '@megumi/desktop/main/ipc/schemas';
import type { RuntimeEvent } from '@megumi/product/host-interface';

type RegisteredHandler = (event: { sender: { send: ReturnType<typeof vi.fn> } }, request: unknown) => Promise<unknown>;

function createIpcMain() {
  const handlers = new Map<string, RegisteredHandler>();
  return {
    handlers,
    ipcMain: {
      handle: vi.fn((channel: string, handler: RegisteredHandler) => {
        handlers.set(channel, handler);
      }),
    },
  };
}

function createSendRequest(): RuntimeIpcRequest<SessionMessageSendPayload, typeof IPC_CHANNELS.chat.sessionMessageSend> {
  return {
    requestId: 'request-1',
    payload: {
      projectId: 'workspace-1',
      text: 'hello',
      clientMessageId: 'client-message-1',
      modelSelection: {
        provider_id: 'deepseek',
        model_id: 'deepseek-chat',
      },
      createdAt: '2026-05-17T00:00:00.000Z',
    },
    meta: {
      channel: IPC_CHANNELS.chat.sessionMessageSend,
      createdAt: '2026-05-17T00:00:00.000Z',
      source: 'renderer',
    },
  };
}

function createContextUsageRequest(): RuntimeIpcRequest<SessionContextUsageGetPayload, typeof IPC_CHANNELS.chat.sessionContextUsageGet> {
  return {
    requestId: 'request-context-usage-1',
    payload: {
      sessionId: 'session-1',
      projectId: 'workspace-1',
      modelId: 'deepseek-chat',
    },
    meta: {
      channel: IPC_CHANNELS.chat.sessionContextUsageGet,
      createdAt: '2026-05-17T00:00:00.000Z',
      source: 'renderer',
    },
  };
}

describe('registerChatHandlers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('returns run id before starting runtime event forwarding', async () => {
    const { handlers, ipcMain } = createIpcMain();
    const runtimeEvent: RuntimeEvent = {
      eventId: 'event-1',
      schemaVersion: 1,
      eventType: 'run.started',
      runId: 'run-1',
      sessionId: 'session-1',
      sequence: 1,
      createdAt: '2026-05-17T00:00:00.000Z',
      source: 'core',
      visibility: 'system',
      persist: 'transient',
      payload: { runKind: 'chat' },
    };
    const events = (async function* immediateEvents() {
      yield runtimeEvent;
    })();
    const order: string[] = [];
    const send = vi.fn(() => order.push('event'));

    const service = {
      host: {
        chat: {
          sendUserInput: vi.fn().mockResolvedValue({
            payload: {
              type: 'agent_run',
              requestId: 'request-1',
              session: {
                id: 'session-1',
                projectId: 'workspace-1',
                title: 'hello',
                status: 'active',
                createdAt: '2026-05-17T00:00:00.000Z',
                updatedAt: '2026-05-17T00:00:00.000Z',
              },
              userMessageId: 'message-user-1',
              run: {
                runId: 'run-1',
                sessionId: 'session-1',
                status: 'running',
                createdAt: '2026-05-17T00:00:00.000Z',
              },
            },
            events,
          }),
        },
      },
    } as unknown as ChatHandlersService;
    const options: RegisterChatHandlersOptions = {
      ipcMain: ipcMain as unknown as RegisterChatHandlersOptions['ipcMain'],
    };

    registerChatHandlers(service, options);

    const handler = handlers.get(IPC_CHANNELS.chat.sessionMessageSend);
    if (!handler) {
      throw new Error('session message send handler was not registered.');
    }

    const response = await handler({ sender: { send } }, createSendRequest());
    order.push('response');

    expect(response).toMatchObject({
      ok: true,
      data: {
        requestId: 'request-1',
        run: { runId: 'run-1' },
      },
    });
    expect(send).not.toHaveBeenCalled();

    await vi.runOnlyPendingTimersAsync();

    expect(send).toHaveBeenCalledWith(IPC_CHANNELS.runtime.event, runtimeEvent);
    expect(order).toEqual(['response', 'event']);
  });

  it('routes session context usage requests through the chat host controller', async () => {
    const { handlers, ipcMain } = createIpcMain();
    const getContextUsage = vi.fn().mockResolvedValue({
      status: 'ok',
      usage: {
        usedTokens: 10,
        totalTokens: 100,
        remainingTokens: 90,
        usedPercent: 10,
        autoCompactPercent: 80,
        shouldAutoCompact: false,
      },
    });
    const service = {
      host: {
        chat: {
          getContextUsage,
        },
      },
    } as unknown as ChatHandlersService;

    registerChatHandlers(service, {
      ipcMain: ipcMain as unknown as RegisterChatHandlersOptions['ipcMain'],
    });

    const handler = handlers.get(IPC_CHANNELS.chat.sessionContextUsageGet);
    if (!handler) {
      throw new Error('session context usage handler was not registered.');
    }

    const response = await handler({ sender: { send: vi.fn() } }, createContextUsageRequest());

    expect(response).toMatchObject({
      ok: true,
      data: {
        status: 'ok',
        usage: {
          usedTokens: 10,
          totalTokens: 100,
          usedPercent: 10,
        },
      },
    });
    expect(getContextUsage).toHaveBeenCalledWith({
      sessionId: 'session-1',
      projectId: 'workspace-1',
      modelId: 'deepseek-chat',
    });
  });

  it('returns an IPC failure when the Product Host emits an invalid result payload', async () => {
    const { handlers, ipcMain } = createIpcMain();
    const service = {
      host: {
        chat: {
          getContextUsage: vi.fn().mockResolvedValue({
            status: 'ok',
            usage: { usedTokens: 'invalid' },
          }),
        },
      },
    } as unknown as ChatHandlersService;

    registerChatHandlers(service, {
      ipcMain: ipcMain as unknown as RegisterChatHandlersOptions['ipcMain'],
    });

    const handler = handlers.get(IPC_CHANNELS.chat.sessionContextUsageGet);
    if (!handler) throw new Error('session context usage handler was not registered.');

    const response = await handler({ sender: { send: vi.fn() } }, createContextUsageRequest());

    expect(response).toMatchObject({
      ok: false,
      error: { code: 'ipc_handler_failed', message: 'Chat service failed.' },
    });
  });
});
