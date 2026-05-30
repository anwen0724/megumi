import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import { registerToolHandlers } from '@megumi/desktop/main/ipc/handlers/tool.handler';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';

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
      getToolExecution: () => undefined,
      resolveApproval: (payload) => ({
        approval: {
          approvalRecordId: 'approval-record-1',
          approvalRequestId: payload.approvalRequestId,
          toolCallId: 'tool-call-1',
          toolExecutionId: 'tool-execution-1',
          runId: 'run-1',
          stepId: 'step-1',
          decision: payload.decision,
          scope: payload.scope,
          decidedBy: 'user',
          decidedAt: payload.decidedAt,
        },
      }),
    });

    expect(ipcMain.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.tool.definitionsList,
      expect.any(Function),
    );
    expect(ipcMain.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.tool.executionGet,
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
      IPC_CHANNELS.tool.executionGet,
      expect.any(Function),
    );
    expect(ipcMain.handle).toHaveBeenCalledWith(
      IPC_CHANNELS.approval.resolve,
      expect.any(Function),
    );
  });

  it('forwards approval resume runtime events while returning only approval data', async () => {
    const sender = { send: vi.fn() };
    const runtimeEvent: RuntimeEvent = {
      eventId: 'event-approval-resolved',
      schemaVersion: 1,
      eventType: 'approval.resolved',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      sequence: 1,
      createdAt: '2026-05-20T00:00:03.000Z',
      source: 'approval',
      visibility: 'user',
      persist: 'required',
      payload: {
        approvalRequestId: 'approval-request-1',
        decision: 'approved',
        scope: 'once',
        decidedAt: '2026-05-20T00:00:03.000Z',
      },
    };
    registerToolHandlers({
      listDefinitions: () => [],
      getToolExecution: () => undefined,
      resolveApproval: (payload) => ({
        approval: {
          approvalRecordId: 'approval-record-1',
          approvalRequestId: payload.approvalRequestId,
          toolCallId: 'tool-call-1',
          toolExecutionId: 'tool-execution-1',
          runId: 'run-1',
          stepId: 'step-1',
          decision: payload.decision,
          scope: payload.scope,
          decidedBy: 'user',
          decidedAt: payload.decidedAt,
        },
        events: async function* () {
          yield runtimeEvent;
        }(),
      }),
    });

    const handler = vi.mocked(ipcMain.handle).mock.calls
      .find(([channel]) => channel === IPC_CHANNELS.approval.resolve)?.[1];
    const response = await handler?.({ sender } as never, {
      requestId: 'ipc-approval-resolve-1',
      payload: {
        approvalRequestId: 'approval-request-1',
        decision: 'approved',
        scope: 'once',
        decidedAt: '2026-05-20T00:00:03.000Z',
      },
      meta: {
        channel: IPC_CHANNELS.approval.resolve,
        source: 'renderer',
        createdAt: '2026-05-20T00:00:03.000Z',
      },
      context: {
        requestId: 'ipc-approval-resolve-1',
        traceId: 'trace-ipc-approval-resolve-1',
        operationName: 'approval.resolve',
        source: 'renderer',
        createdAt: '2026-05-20T00:00:03.000Z',
      },
    });

    expect(response).toMatchObject({
      ok: true,
      data: {
        approval: {
          approvalRecordId: 'approval-record-1',
          approvalRequestId: 'approval-request-1',
        },
      },
    });
    expect(response?.data).not.toHaveProperty('events');
    await vi.waitFor(() => {
      expect(sender.send).toHaveBeenCalledWith(IPC_CHANNELS.runtime.event, runtimeEvent);
    });
  });
});
