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
      modelSelection: { provider_id: 'provider', model_id: 'model' },
    },
    meta: {
      channel: IPC_CHANNELS.chat.sessionContextUsageGet,
      createdAt: '2026-05-17T00:00:00.000Z',
      source: 'renderer',
    },
  };
}

function createSessionHydrationRequest(): RuntimeIpcRequest<
  { projectId: string; sessionId: string },
  typeof IPC_CHANNELS.chat.sessionHydrationGet
> {
  return {
    requestId: 'request-session-hydration-1',
    payload: {
      projectId: 'workspace-1',
      sessionId: 'session-1',
    },
    meta: {
      channel: IPC_CHANNELS.chat.sessionHydrationGet,
      createdAt: '2026-05-17T00:00:00.000Z',
      source: 'renderer',
    },
  };
}

describe('registerChatHandlers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('routes session context usage requests through the chat host controller', async () => {
    const { handlers, ipcMain } = createIpcMain();
    const getContextUsage = vi.fn().mockResolvedValue({
      status: 'available',
      usage: {
        usedTokens: 110,
        totalTokens: 100,
        remainingTokens: -10,
        usedPercent: 110,
        autoCompactPercent: 80,
        accuracy: 'estimated',
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
        status: 'available',
        usage: {
          usedTokens: 110,
          totalTokens: 100,
          remainingTokens: -10,
          usedPercent: 110,
        },
      },
    });
    expect(getContextUsage).toHaveBeenCalledWith({
      sessionId: 'session-1',
      modelSelection: { provider_id: 'provider', model_id: 'model' },
    });
  });

  it('returns an IPC failure when the Product Host emits an invalid result payload', async () => {
    const { handlers, ipcMain } = createIpcMain();
    const service = {
      host: {
        chat: {
          getContextUsage: vi.fn().mockResolvedValue({
            status: 'available',
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
      data: { code: 'ipc_handler_failed', message: 'Chat service failed.' },
    });
  });

  it('routes session hydration requests through the chat host controller', async () => {
    const { handlers, ipcMain } = createIpcMain();
    const getSessionHydration = vi.fn().mockResolvedValue({
      messages: [],
      diagnostics: [],
      runs: [],
      runtimeEvents: [],
    });
    const service = {
      host: {
        chat: {
          getSessionHydration,
        },
      },
    } as unknown as ChatHandlersService;

    registerChatHandlers(service, {
      ipcMain: ipcMain as unknown as RegisterChatHandlersOptions['ipcMain'],
    });

    const handler = handlers.get('session:hydration:get');
    if (!handler) throw new Error('session hydration handler was not registered.');

    const response = await handler({ sender: { send: vi.fn() } }, createSessionHydrationRequest());

    expect(response).toMatchObject({
      ok: true,
      data: {
        messages: [],
        runs: [],
        runtimeEvents: [],
      },
    });
    expect(getSessionHydration).toHaveBeenCalledWith({
      projectId: 'workspace-1',
      sessionId: 'session-1',
    });
  });
});
