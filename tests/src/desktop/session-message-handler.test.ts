import { describe, expect, it, vi } from 'vitest';
import type { AppApi, AppStartRunRequest } from '../../../src/app';
import type { DesktopIpcContext } from '../../../src/desktop/ipc/ipc-context';
import { handleSessionOperation } from '../../../src/desktop/ipc/session.handler';
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
    workspace: {
      id: 'workspace-1',
      label: 'Megumi',
      path: 'C:/all/work/study/megumi',
    },
    createdAt: '2026-06-19T10:00:00.000Z',
  };
}

function createContext() {
  const startRun = vi.fn(async () => ({
    runId: 'run-1',
    sessionId: 'session-1',
    workspaceId: 'workspace-1',
    status: 'running' as const,
    result: { assistantText: 'must not be returned by immediate ack' },
  }));
  const appApi: AppApi = {
    startRun,
    resumeRun: vi.fn(),
    cancelRun: vi.fn(),
    retryRun: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
  };
  const context: DesktopIpcContext = {
    appApi,
    hosts: {},
    getMainWindow: () => undefined,
  };
  return { context, startRun };
}

describe('handleSessionOperation session.message.send', () => {
  it('delegates the new renderer DTO to AppApi.startRun and returns immediate ack', async () => {
    const { context, startRun } = createContext();
    const result = await handleSessionOperation('session.message.send', createRequest(), context);

    expect(startRun).toHaveBeenCalledTimes(1);
    const [request, client] = startRun.mock.calls[0] as [AppStartRunRequest, unknown];
    expect(request.rawInput.text).toBe('hello');
    expect(request.providerId).toBe('deepseek');
    expect(client).toMatchObject({
      clientKind: 'desktop',
      requestId: 'ipc-session-message-request-1',
      workspaceHint: 'C:/all/work/study/megumi',
    });
    expect(result).toEqual({
      requestId: 'ipc-session-message-request-1',
      runId: 'run-1',
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      status: 'running',
      accepted: true,
    });
    expect(result).not.toHaveProperty('result');
  });

  it('rejects old renderer envelope before AppApi.startRun', async () => {
    const { context, startRun } = createContext();
    await expect(handleSessionOperation('session.message.send', {
      requestId: 'legacy-request',
      payload: {
        message: { id: 'message-user-1', content: 'legacy', createdAt: '2026-06-19T10:00:00.000Z' },
      },
    }, context)).rejects.toThrow('session.message.send expects SessionMessageSendRequestDto');
    expect(startRun).not.toHaveBeenCalled();
  });
});
