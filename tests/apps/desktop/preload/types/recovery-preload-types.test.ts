// @vitest-environment node
import { ipcRenderer } from 'electron';
import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { api as preloadApi } from '@megumi/desktop/preload/api';
import type { MegumiAPI } from '@megumi/desktop/preload/types';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { RuntimeIpcRequest, RuntimeIpcResult } from '@megumi/shared/ipc-contracts';
import type {
  RecoverableRunListData,
  RecoverableRunListPayload,
  RunCancelData,
  RunCancelPayload,
  RunResumeData,
  RunResumePayload,
  RunRetryData,
  RunRetryPayload,
  WorkspaceRestoreData,
  WorkspaceRestorePayload,
} from '@megumi/shared/ipc-schemas';

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke: vi.fn(),
  },
}));

describe('recovery preload types', () => {
  beforeEach(() => {
    vi.mocked(ipcRenderer.invoke).mockReset();
  });

  it('exposes primary recovery controls under window.megumi', () => {
    expectTypeOf<MegumiAPI['recovery']['listRecoverableRuns']>().returns.resolves.toEqualTypeOf<
      RuntimeIpcResult<RecoverableRunListData, typeof IPC_CHANNELS.recovery.recoverableRunsList>
    >();
    expectTypeOf<Parameters<MegumiAPI['recovery']['listRecoverableRuns']>[0]>().toEqualTypeOf<
      RuntimeIpcRequest<RecoverableRunListPayload, typeof IPC_CHANNELS.recovery.recoverableRunsList>
    >();
    expectTypeOf<MegumiAPI['recovery']['resume']>().returns.resolves.toEqualTypeOf<
      RuntimeIpcResult<RunResumeData, typeof IPC_CHANNELS.recovery.resume>
    >();
    expectTypeOf<Parameters<MegumiAPI['recovery']['resume']>[0]>().toEqualTypeOf<
      RuntimeIpcRequest<RunResumePayload, typeof IPC_CHANNELS.recovery.resume>
    >();
    expectTypeOf<MegumiAPI['recovery']['cancel']>().returns.resolves.toEqualTypeOf<
      RuntimeIpcResult<RunCancelData, typeof IPC_CHANNELS.recovery.cancel>
    >();
    expectTypeOf<Parameters<MegumiAPI['recovery']['cancel']>[0]>().toEqualTypeOf<
      RuntimeIpcRequest<RunCancelPayload, typeof IPC_CHANNELS.recovery.cancel>
    >();
    expectTypeOf<MegumiAPI['recovery']['retry']>().returns.resolves.toEqualTypeOf<
      RuntimeIpcResult<RunRetryData, typeof IPC_CHANNELS.recovery.retry>
    >();
    expectTypeOf<Parameters<MegumiAPI['recovery']['retry']>[0]>().toEqualTypeOf<
      RuntimeIpcRequest<RunRetryPayload, typeof IPC_CHANNELS.recovery.retry>
    >();
    expectTypeOf<MegumiAPI['recovery']['restoreWorkspaceChangeSet']>().returns.resolves.toEqualTypeOf<
      RuntimeIpcResult<WorkspaceRestoreData, typeof IPC_CHANNELS.recovery.workspaceRestore>
    >();
    expectTypeOf<Parameters<MegumiAPI['recovery']['restoreWorkspaceChangeSet']>[0]>().toEqualTypeOf<
      RuntimeIpcRequest<WorkspaceRestorePayload, typeof IPC_CHANNELS.recovery.workspaceRestore>
    >();
  });

  it('invokes workspace restore through the typed recovery preload API', async () => {
    const request = {
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
    } satisfies RuntimeIpcRequest<WorkspaceRestorePayload, typeof IPC_CHANNELS.recovery.workspaceRestore>;
    const result = {
      ok: true,
      data: {
        request: {
          restoreRequestId: 'workspace-restore-request-1',
          changeSetId: 'change-set-1',
          sessionId: 'session-1',
          runId: 'run-1',
          requestedBy: 'user',
          status: 'completed',
          requestedAt: '2026-06-05T10:00:00.000Z',
          completedAt: '2026-06-05T10:00:01.000Z',
        },
        result: {
          restoreResultId: 'workspace-restore-result-1',
          restoreRequestId: 'workspace-restore-request-1',
          changeSetId: 'change-set-1',
          sessionId: 'session-1',
          runId: 'run-1',
          status: 'restored',
          restoredAt: '2026-06-05T10:00:01.000Z',
        },
        fileResults: [],
      },
      meta: {
        requestId: 'request_workspace_restore',
        channel: IPC_CHANNELS.recovery.workspaceRestore,
        handledAt: '2026-06-05T10:00:02.000Z',
      },
    } satisfies RuntimeIpcResult<WorkspaceRestoreData, typeof IPC_CHANNELS.recovery.workspaceRestore>;
    vi.mocked(ipcRenderer.invoke).mockResolvedValue(result);

    await expect(preloadApi.recovery.restoreWorkspaceChangeSet(request)).resolves.toBe(result);

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.recovery.workspaceRestore,
      request,
    );
  });
});
