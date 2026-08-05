/*
 * Desktop IPC handlers for approval decisions.
 */
import {
  ApprovalResolveResultSchema,
  type ProductHostInterface,
} from '@megumi/product/host';

import type { ProductRuntimeLogger } from '@megumi/product';
import { electronIpcMain, type DesktopIpcMain } from '../../adapters/electron-ipc-main-adapter';
import { createIpcRequestHandler } from '../create-request-handler';

import { IPC_CHANNELS } from '../channels';
import type { RuntimeIpcError } from '../contracts';
import { ApprovalResolveRequestSchema } from '../schemas';

export interface ApprovalHandlersService {
  host: Pick<ProductHostInterface, 'approval'>;
}

export interface RegisterApprovalHandlersOptions {
  logger?: ProductRuntimeLogger;
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
      return result.payload;
    },
    mapError: mapApprovalIpcError,
  }));
}


function mapApprovalIpcError(): RuntimeIpcError {
  return {
    code: 'ipc_handler_failed',
    message: 'Approval service failed.',
  };
}
