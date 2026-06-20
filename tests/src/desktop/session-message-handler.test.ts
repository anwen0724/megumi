import { describe, expect, it, vi } from 'vitest';
import type { AppApi, AppCancelRunRequest, AppStartRunRequest } from '../../../src/app';
import type { DesktopIpcContext } from '../../../src/desktop/ipc/ipc-context';
import { handleSessionOperation } from '../../../src/desktop/ipc/session.handler';
import { createRendererRuntimeIpcRequest } from '../../../src/ui/shared/ipc/runtime-request';
import { IPC_CHANNELS } from '../../../src/shared/renderer-contracts/ipc';
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
  const cancelRun = vi.fn(async () => ({
    runId: 'run-1',
    sessionId: 'session-1',
    status: 'cancelled' as const,
  }));
  const appApi: AppApi = {
    startRun,
    resumeRun: vi.fn(),
    cancelRun,
    retryRun: vi.fn(),
  };
  const context: DesktopIpcContext = {
    appApi,
    hosts: {} as never,
    getMainWindow: () => undefined,
  };
  return { context, startRun, cancelRun };
}

describe('handleSessionOperation session.message.send', () => {
  it('delegates the new renderer DTO to AppApi.startRun and returns immediate ack', async () => {
    const { context, startRun } = createContext();
    const result = await handleSessionOperation('session.message.send', createRequest(), context);

    expect(startRun).toHaveBeenCalledTimes(1);
    const [request, client] = startRun.mock.calls[0] as unknown as [AppStartRunRequest, unknown];
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

  it('unwraps the legacy cancel envelope so targetRequestId reaches AppApi.cancelRun', async () => {
    const { context, cancelRun } = createContext();
    const result = await handleSessionOperation(
      'session.message.cancel',
      createRendererRuntimeIpcRequest(IPC_CHANNELS.session.message.cancel, {
        targetRequestId: 'ipc-session-message-request-1',
      }, {
        traceId: 'trace-1',
      }),
      context,
    );

    expect(cancelRun).toHaveBeenCalledTimes(1);
    const [request] = cancelRun.mock.calls[0] as unknown as [AppCancelRunRequest];
    expect(request.metadata).toMatchObject({
      targetRequestId: 'ipc-session-message-request-1',
    });
    expect(request.reason).toBe('ipc-session-message-request-1');
    expect(result).toMatchObject({
      runId: 'run-1',
      sessionId: 'session-1',
      status: 'cancelled',
    });
  });
});
