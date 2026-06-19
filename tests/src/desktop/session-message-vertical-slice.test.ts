import { describe, expect, it, vi } from 'vitest';
import type { AppApi, AppEvent } from '../../../src/app';
import type { DesktopIpcContext } from '../../../src/desktop/ipc/ipc-context';
import { handleSessionOperation } from '../../../src/desktop/ipc/session.handler';
import { registerChatStreamEventForwarder } from '../../../src/desktop/ipc/chat-stream-event-forwarder';
import { registerRuntimeEventForwarder } from '../../../src/desktop/ipc/runtime-event-forwarder';
import type { SessionMessageSendRequestDto } from '../../../src/shared/renderer-contracts/session-message';

function createRequest(): SessionMessageSendRequestDto {
  return {
    requestId: 'ipc-session-message-request-1',
    traceId: 'trace-1',
    source: 'renderer',
    sessionId: 'session-1',
    providerId: 'deepseek',
    modelId: 'deepseek-chat',
    message: {
      id: 'message-user-1',
      text: 'hello',
      createdAt: '2026-06-19T10:00:00.000Z',
    },
    workspace: { id: 'workspace-1', path: 'C:/all/work/study/megumi' },
    createdAt: '2026-06-19T10:00:00.000Z',
  };
}

describe('session message vertical slice', () => {
  it('keeps immediate ack separate from assistant stream events', async () => {
    const subscribers: Array<(event: AppEvent) => void> = [];
    const send = vi.fn();
    const appApi: AppApi = {
      startRun: vi.fn(async () => ({
        runId: 'run-1',
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        status: 'running' as const,
      })),
      resumeRun: vi.fn(),
      cancelRun: vi.fn(),
      retryRun: vi.fn(),
      subscribe: vi.fn((callback) => {
        subscribers.push(callback);
        return () => undefined;
      }),
    };
  const context: DesktopIpcContext = {
    appApi,
    hosts: {} as never,
    getMainWindow: () => ({ webContents: { send } }) as never,
  };

    registerChatStreamEventForwarder(context);
    registerRuntimeEventForwarder(context);

    const ack = await handleSessionOperation('session.message.send', createRequest(), context);

    expect(ack).toEqual({
      requestId: 'ipc-session-message-request-1',
      runId: 'run-1',
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      status: 'running',
      accepted: true,
    });

    subscribers.forEach((subscriber) => subscriber({
      type: 'ai.message.event',
      source: 'agent',
      occurredAt: '2026-06-19T10:00:01.000Z',
      payload: {
        runId: 'run-1',
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'pong' },
        },
      },
    }));
    subscribers.forEach((subscriber) => subscriber({
      type: 'run.completed',
      source: 'agent',
      occurredAt: '2026-06-19T10:00:02.000Z',
      payload: {
        runId: 'run-1',
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
      },
    }));

    expect(send).toHaveBeenCalledWith('megumi:chat-stream:event', expect.objectContaining({
      type: 'ai.message.event',
      runId: 'run-1',
      sessionId: 'session-1',
      payload: expect.objectContaining({
        event: expect.objectContaining({ type: 'content_block_delta' }),
      }),
    }));
    expect(send).toHaveBeenCalledWith('megumi:runtime:event', expect.objectContaining({
      type: 'run.completed',
      payload: expect.objectContaining({ runId: 'run-1' }),
    }));
  });
});
