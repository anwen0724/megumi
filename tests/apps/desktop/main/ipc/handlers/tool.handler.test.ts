import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import { registerToolHandlers } from '@megumi/desktop/main/ipc/handlers/tool.handler';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

describe('registerToolHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers primary tool/approval IPC channels and deprecated agent bridges', () => {
    registerToolHandlers({
      listDefinitions: () => [],
      getToolCall: () => undefined,
      resolveApproval: (payload) => ({
        approvalRecordId: 'approval-record-1',
        approvalRequestId: payload.approvalRequestId,
        toolCallId: 'tool-call-1',
        runId: 'run-1',
        stepId: 'step-1',
        decision: payload.decision,
        scope: payload.scope,
        decidedBy: 'user',
        decidedAt: payload.decidedAt,
      }),
    });

    expect(ipcMain.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.tool.definitionsList,
      expect.any(Function),
    );
    expect(ipcMain.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.tool.callGet,
      expect.any(Function),
    );
    expect(ipcMain.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.approval.resolve,
      expect.any(Function),
    );
    expect(ipcMain.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.tool.definitionsList,
      expect.any(Function),
    );
    expect(ipcMain.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.tool.callGet,
      expect.any(Function),
    );
    expect(ipcMain.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.approval.resolve,
      expect.any(Function),
    );
  });
});
