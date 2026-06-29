import { IPC_CHANNELS } from '@megumi/shared/ipc';
import type { RuntimeIpcRequest } from '@megumi/shared/ipc';
import type { RuntimeIpcError } from '@megumi/shared/ipc';
import type {
  ApprovalResolveData,
  ApprovalResolvePayload,
} from '@megumi/shared/ipc';
import {
  ApprovalResolveRequestSchema,
} from '@megumi/shared/ipc';
import type { RuntimeLogger } from '../../services/agent-run/runtime-logger.service';
import { electronIpcMain, type DesktopIpcMain } from '../../shell/electron-ipc-main-host';
import type { HostPermissionController } from '@megumi/coding-agent/host-interface';
import { createIpcRequestHandler } from '../create-ipc-request-handler';
import { forwardRuntimeEvents } from '.././runtime-event-forwarder';

export type PermissionHandlersService = HostPermissionController;

export interface RegisterToolHandlersOptions {
  logger?: RuntimeLogger;
  ipcMain?: DesktopIpcMain;
}

export function registerToolHandlers(
  service: PermissionHandlersService,
  options: RegisterToolHandlersOptions = {},
): void {
  const ipcMain = options.ipcMain ?? electronIpcMain;

  ipcMain.handle(
    IPC_CHANNELS.approval.resolve,
    createIpcRequestHandler({
      channel: IPC_CHANNELS.approval.resolve,
      requestSchema: ApprovalResolveRequestSchema,
      logger: options.logger,
      handle: async (
        request: RuntimeIpcRequest<ApprovalResolvePayload, typeof IPC_CHANNELS.approval.resolve>,
        event,
      ): Promise<ApprovalResolveData> => {
        const response = service.resolve(request.payload);
        if (response.events) {
          void forwardRuntimeEvents(event.sender, response.events, { logger: options.logger });
        }
        return response.data;
      },
      mapError: mapToolIpcError,
    }),
  );






}

function mapToolIpcError(): RuntimeIpcError {
  return {
    code: 'ipc_handler_failed',
    message: 'Tool service failed.',
    severity: 'error',
    retryable: true,
    source: 'main',
  };
}
