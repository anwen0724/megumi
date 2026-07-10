/*
 * Desktop IPC handlers for approval decisions.
 */
import {
  ApprovalResolveResultSchema,
  type ProductHostInterface,
  type RuntimeEvent,
} from '@megumi/product/host-interface';
import type { RuntimeLogger } from '@megumi/product/logging';
import { electronIpcMain, type DesktopIpcMain } from '../../adapters/electron-ipc-main-adapter';
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
    responseSchema: ApprovalResolveResultSchema,
    logger: options.logger,
    handle: async (request, event) => {
      const result = await service.host.approval.resolve(request.payload);
      if (result.events) {
        scheduleEvents(event.sender, result.events, options.logger);
      }
      return result.payload;
    },
    mapError: mapApprovalIpcError,
  }));
}

function scheduleEvents(
  sender: { send(channel: string, event: RuntimeEvent): void },
  events: AsyncIterable<RuntimeEvent>,
  logger?: RuntimeLogger,
): void {
  setTimeout(() => {
    void forwardRuntimeEvents(sender, events, { logger }).catch((error) => {
      logger?.warn?.('Runtime event forwarding failed.', { error: String(error) });
    });
  }, 0);
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
