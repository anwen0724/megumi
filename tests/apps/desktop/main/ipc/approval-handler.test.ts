/*
 * Verifies approval IPC result forwarding without swallowing controller failures.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/desktop/main/ipc/channels';
import {
  registerApprovalHandlers,
  type ApprovalHandlersService,
  type RegisterApprovalHandlersOptions,
} from '@megumi/desktop/main/ipc/handlers/approval.handler';
import type { RuntimeIpcRequest } from '@megumi/desktop/main/ipc/contracts';
import type { ApprovalResolvePayload } from '@megumi/desktop/main/ipc/schemas';
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

function approvalRequest(): RuntimeIpcRequest<ApprovalResolvePayload, typeof IPC_CHANNELS.approval.resolve> {
  return {
    requestId: 'request-approval-1',
    payload: {
      approvalRequestId: 'approval-1',
      decision: 'approved',
      scope: 'once',
      decidedAt: '2026-07-09T00:00:00.000Z',
    },
    meta: {
      channel: IPC_CHANNELS.approval.resolve,
      createdAt: '2026-07-09T00:00:00.000Z',
      source: 'renderer',
    },
  };
}

describe('registerApprovalHandlers', () => {
  beforeEach(() => {
    vi.mocked(forwardRuntimeEvents).mockReset();
  });

  it('returns failed approval controller result as IPC data', async () => {
    const { handlers, ipcMain } = createIpcMain();
    const service = {
      host: {
        approval: {
          resolve: vi.fn(async () => ({
            status: 'failed' as const,
            approvalRequestId: 'approval-1',
            failure: {
              code: 'runtime_interrupted' as const,
              message: 'Approval continuation is no longer available in this runtime.',
              retryable: false,
            },
            events: [],
          })),
        },
      },
    } as unknown as ApprovalHandlersService;

    registerApprovalHandlers(service, {
      ipcMain: ipcMain as unknown as RegisterApprovalHandlersOptions['ipcMain'],
    });

    const handler = handlers.get(IPC_CHANNELS.approval.resolve);
    if (!handler) {
      throw new Error('approval resolve handler was not registered.');
    }

    const response = await handler({ sender: { send: vi.fn() } }, approvalRequest());

    expect(response).toMatchObject({
      ok: true,
      data: {
        status: 'failed',
        approvalRequestId: 'approval-1',
        failure: {
          code: 'runtime_interrupted',
          message: 'Approval continuation is no longer available in this runtime.',
        },
      },
    });
    expect(forwardRuntimeEvents).toHaveBeenCalledTimes(1);
  });

  it('returns resolved approval data and forwards runtime events', async () => {
    const { handlers, ipcMain } = createIpcMain();
    async function* events() {}
    const service = {
      host: {
        approval: {
          resolve: vi.fn(async () => ({
            status: 'resolved' as const,
            data: {
              approval: {
                approvalRecordId: 'approval-record-1',
                approvalRequestId: 'approval-1',
                toolCallId: 'tool-call-1',
                toolExecutionId: 'tool-call-1',
                runId: 'run-1',
                stepId: 'unknown',
                decision: 'approved' as const,
                scope: 'once' as const,
                decidedBy: 'user' as const,
                decidedAt: '2026-07-09T00:00:00.000Z',
              },
            },
            events: events(),
          })),
        },
      },
    } as unknown as ApprovalHandlersService;

    registerApprovalHandlers(service, {
      ipcMain: ipcMain as unknown as RegisterApprovalHandlersOptions['ipcMain'],
    });

    const handler = handlers.get(IPC_CHANNELS.approval.resolve);
    if (!handler) {
      throw new Error('approval resolve handler was not registered.');
    }

    const response = await handler({ sender: { send: vi.fn() } }, approvalRequest());

    expect(response).toMatchObject({
      ok: true,
      data: {
        status: 'resolved',
        data: {
          approval: {
            approvalRequestId: 'approval-1',
            decision: 'approved',
          },
        },
      },
    });
    expect(forwardRuntimeEvents).toHaveBeenCalledTimes(1);
  });
});
