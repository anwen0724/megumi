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
import { forwardRuntimeEvents } from '@megumi/desktop/main/ipc/event-forwarders';

vi.mock('@megumi/desktop/main/ipc/event-forwarders', () => ({
  forwardRuntimeEvents: vi.fn(),
}));

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
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      message: {
        id: 'client-message-1',
        content: 'hello',
        createdAt: '2026-05-17T00:00:00.000Z',
      },
      context: {
        workspaceId: 'workspace-1',
        workspacePath: 'C:/repo',
        sessionTitle: 'hello',
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
    vi.mocked(forwardRuntimeEvents).mockReset();
  });

  it('returns run id before starting runtime event forwarding', async () => {
    const { handlers, ipcMain } = createIpcMain();
    const events = (async function* emptyEvents() {})();

    const service = {
      host: {
        chat: {
          sendUserInput: vi.fn().mockResolvedValue({
            type: 'agent_run',
            requestId: 'request-1',
            session: {
              id: 'session-1',
              projectId: 'workspace-1',
              title: 'hello',
              createdAt: '2026-05-17T00:00:00.000Z',
              updatedAt: '2026-05-17T00:00:00.000Z',
            },
            userMessageId: 'message-user-1',
            run: { runId: 'run-1' },
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

    const response = await handler({ sender: { send: vi.fn() } }, createSendRequest());

    expect(response).toMatchObject({
      ok: true,
      data: {
        requestId: 'request-1',
        runId: 'run-1',
      },
    });
    expect(forwardRuntimeEvents).not.toHaveBeenCalled();

    await vi.runOnlyPendingTimersAsync();

    expect(forwardRuntimeEvents).toHaveBeenCalledTimes(1);
    expect(forwardRuntimeEvents).toHaveBeenCalledWith(
      expect.anything(),
      events,
      expect.any(Object),
    );
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
});
