import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import { registerAgentToolHandlers } from '@megumi/desktop/main/ipc/handlers/agent-tool.handler';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

describe('registerAgentToolHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers tool and approval handlers', () => {
    registerAgentToolHandlers({
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
      IPC_CHANNELS.agent.tool.definitionsList,
      expect.any(Function),
    );
    expect(ipcMain.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.agent.tool.callGet,
      expect.any(Function),
    );
    expect(ipcMain.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.agent.approval.resolve,
      expect.any(Function),
    );
  });
});
