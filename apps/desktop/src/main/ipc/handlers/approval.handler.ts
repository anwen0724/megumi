/*
 * Desktop IPC handlers for approval decisions.
 */
import type { ProductHostInterface } from '@megumi/product/host-interface';
import type { RuntimeLogger } from '@megumi/product/logging';
import { electronIpcMain, type DesktopIpcMain } from '../../shell/electron-ipc-main-host';
import { createIpcRequestHandler } from '../create-request-handler';
import { forwardRuntimeEvents } from '../event-forwarders';
import { IPC_CHANNELS } from '../channels';
import type { RuntimeIpcError } from '../contracts';
import { ApprovalResolveRequestSchema } from '../schemas';

export interface ApprovalHandlersService {
  host: Pick<ProductHostInterface, 'approval'>;
}

export interface RegisterApprovalHandlersOptions {
  logger?: RuntimeLogger;
  ipcMain?: DesktopIpcMain;
}

export function registerApprovalHandlers(
  service: ApprovalHandlersService,
  options: RegisterApprovalHandlersOptions = {},
): void {
  const ipcMain = options.ipcMain ?? electronIpcMain;

  ipcMain.handle(IPC_CHANNELS.approval.resolve, createIpcRequestHandler({
    channel: IPC_CHANNELS.approval.resolve,
    requestSchema: ApprovalResolveRequestSchema,
    logger: options.logger,
    handle: async (request, event) => {
      const result = await service.host.approval.resolve(request.payload);
      if (result.status === 'resolved' && result.events) {
        void forwardRuntimeEvents(event.sender, result.events, { logger: options.logger });
      }
      if (result.status === 'failed' && result.events) {
        void forwardRuntimeEvents(event.sender, asyncEvents(result.events), { logger: options.logger });
      }
      if (result.status === 'failed') {
        return {
          status: 'failed',
          approvalRequestId: result.approvalRequestId,
          failure: result.failure,
        };
      }
      return {
        status: 'resolved',
        data: result.data,
      };
    },
    mapError: mapApprovalIpcError,
  }));
}

async function* asyncEvents<T>(events: T[]): AsyncIterable<T> {
  yield* events;
}

function mapApprovalIpcError(): RuntimeIpcError {
  return {
    code: 'ipc_handler_failed',
    message: 'Approval service failed.',
    severity: 'error',
    retryable: true,
    source: 'main',
  };
}
