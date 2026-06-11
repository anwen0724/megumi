import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@megumi/shared/ipc';
import { registerRecoveryHandlers } from '@megumi/desktop/main/ipc/handlers/recovery.handler';
import type { RecoveryService } from '@megumi/desktop/main/services/recovery.service';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

function getRegisteredHandler(channel: string) {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([registeredChannel]) => registeredChannel === channel);
  const handler = call?.[1];

  if (!handler) {
    throw new Error(`Missing handler for ${channel}`);
  }

  return handler;
}

describe('registerRecoveryHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers primary recovery handlers and deprecated agent bridges with runtime envelope schemas', async () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const restoreWorkspaceChangeSet = vi.fn(async (payload) => ({
      request: {
        restoreRequestId: 'workspace-restore-request-1',
        changeSetId: payload.changeSetId,
        sessionId: 'session_123',
        runId: 'run_123',
        requestedBy: payload.requestedBy,
        status: 'completed' as const,
        requestedAt: '2026-06-05T10:00:00.000Z',
        completedAt: '2026-06-05T10:00:01.000Z',
      },
      result: {
        restoreResultId: 'workspace-restore-result-1',
        restoreRequestId: 'workspace-restore-request-1',
        changeSetId: payload.changeSetId,
        sessionId: 'session_123',
        runId: 'run_123',
        status: 'restored' as const,
        restoredAt: '2026-06-05T10:00:01.000Z',
        metadata: {
          changedFileCount: 1,
          restoredCount: 1,
          conflictCount: 0,
          failedCount: 0,
          noopCount: 0,
        },
      },
      fileResults: [],
    }));
    const service: RecoveryService & {
      restoreWorkspaceChangeSet: typeof restoreWorkspaceChangeSet;
    } = {
      listRecoverableRuns: () => [],
      resumeRun: (payload) => ({
        ...payload,
        resumeRequestId: 'resume_request_123',
        createdAt: '2026-05-16T10:00:00.000Z',
      }),
      cancelRun: (payload) => ({
        ...payload,
        cancelRequestId: 'cancel_request_123',
        createdAt: '2026-05-16T10:00:00.000Z',
      }),
      retryRun: (payload) => ({
        ...payload,
        retryRequestId: 'retry_request_123',
        createdAt: '2026-05-16T10:00:00.000Z',
      }),
      restoreWorkspaceChangeSet,
    };

    registerRecoveryHandlers(service, { logger });

    expect(ipcMain.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.recovery.recoverableRunsList,
      expect.any(Function),
    );
    expect(ipcMain.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.recovery.resume,
      expect.any(Function),
    );
    expect(ipcMain.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.recovery.cancel,
      expect.any(Function),
    );
    expect(ipcMain.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.recovery.retry,
      expect.any(Function),
    );
    expect(ipcMain.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.recovery.workspaceRestore,
      expect.any(Function),
    );

    const resumeHandler = getRegisteredHandler(IPC_CHANNELS.recovery.resume);
    const response = await resumeHandler({} as never, {
      requestId: 'request_123',
      payload: {
        runId: 'run_123',
        checkpointId: 'checkpoint_123',
        requestedBy: 'user',
        reason: 'manual_resume',
        resumeMode: 'from_checkpoint',
      },
      meta: {
        channel: IPC_CHANNELS.recovery.resume,
        createdAt: '2026-05-16T10:00:00.000Z',
        source: 'renderer',
      },
    });

    expect(response.ok).toBe(true);
    expect(response.data.request.resumeRequestId).toBe('resume_request_123');

    const restoreHandler = getRegisteredHandler(IPC_CHANNELS.recovery.workspaceRestore);
    const restoreResponse = await restoreHandler({} as never, {
      requestId: 'request_workspace_restore',
      payload: {
        changeSetId: 'change-set-1',
        requestedBy: 'user',
      },
      meta: {
        channel: IPC_CHANNELS.recovery.workspaceRestore,
        createdAt: '2026-06-05T10:00:00.000Z',
        source: 'renderer',
      },
    });

    expect(restoreWorkspaceChangeSet).toHaveBeenCalledWith({
      changeSetId: 'change-set-1',
      requestedBy: 'user',
    });
    expect(restoreResponse.ok).toBe(true);
    expect(restoreResponse.data.result.restoreResultId).toBe('workspace-restore-result-1');
  });
});

