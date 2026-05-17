import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
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
    const service: RecoveryService = {
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
      IPC_CHANNELS.recovery.resume,
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
  });
});
