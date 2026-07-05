/*
 * Desktop IPC handlers for approval decisions.
 */
import type { CodingAgentHostInterface } from '@megumi/coding-agent/host-interface';
import type { RuntimeLogger } from '../../services/agent-run/runtime-logger.service';
import { electronIpcMain, type DesktopIpcMain } from '../../shell/electron-ipc-main-host';
import { createIpcRequestHandler } from '../create-request-handler';
import { forwardRuntimeEvents } from '../event-forwarders';
import { IPC_CHANNELS } from '../channels';
import type { RuntimeIpcError } from '../contracts';
import { ApprovalResolveRequestSchema } from '../schemas';

export interface ApprovalHandlersService {
  host: Pick<CodingAgentHostInterface, 'approval'>;
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
      if (result.events) {
        void forwardRuntimeEvents(event.sender, result.events, { logger: options.logger });
      }
      return result.data;
    },
    mapError: mapApprovalIpcError,
  }));
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
