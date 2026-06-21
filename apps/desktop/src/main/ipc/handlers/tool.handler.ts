import { IPC_CHANNELS } from '@megumi/shared/ipc';
import type { RuntimeIpcRequest } from '@megumi/shared/ipc';
import type { RuntimeIpcError } from '@megumi/shared/ipc';
import type {
  ApprovalResolveData,
  ApprovalResolvePayload,
  ToolExecutionGetData,
  ToolExecutionGetPayload,
  ToolDefinitionsListData,
  ToolDefinitionsListPayload,
} from '@megumi/shared/ipc';
import {
  ApprovalResolveRequestSchema,
  ToolExecutionGetRequestSchema,
  ToolDefinitionsListRequestSchema,
} from '@megumi/shared/ipc';
import type { RuntimeLogger } from '../../services/runtime/runtime-logger.service';
import { electronIpcMain, type DesktopIpcMain } from '../../host/electron-ipc-main-host';
import type { ToolService } from '../../services/tool/tool.service';
import { createIpcRequestHandler } from '../create-ipc-request-handler';
import { forwardRuntimeEvents } from '../runtime-event-forwarder';

export type ToolHandlersService = Pick<
  ToolService,
  'listDefinitions' | 'getToolExecution' | 'resolveApproval'
>;

export interface RegisterToolHandlersOptions {
  logger?: RuntimeLogger;
  ipcMain?: DesktopIpcMain;
}

export function registerToolHandlers(
  service: ToolHandlersService,
  options: RegisterToolHandlersOptions = {},
): void {
  const ipcMain = options.ipcMain ?? electronIpcMain;

  ipcMain.handle(
    IPC_CHANNELS.tool.definitionsList,
    createIpcRequestHandler({
      channel: IPC_CHANNELS.tool.definitionsList,
      requestSchema: ToolDefinitionsListRequestSchema,
      logger: options.logger,
      handle: (
        request: RuntimeIpcRequest<ToolDefinitionsListPayload, typeof IPC_CHANNELS.tool.definitionsList>,
      ): ToolDefinitionsListData => ({
        tools: service.listDefinitions(request.payload),
      }),
      mapError: mapToolIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.tool.executionGet,
    createIpcRequestHandler({
      channel: IPC_CHANNELS.tool.executionGet,
      requestSchema: ToolExecutionGetRequestSchema,
      logger: options.logger,
      handle: (
        request: RuntimeIpcRequest<ToolExecutionGetPayload, typeof IPC_CHANNELS.tool.executionGet>,
      ): ToolExecutionGetData => ({
        toolExecution: service.getToolExecution(request.payload.toolExecutionId) as ToolExecutionGetData['toolExecution'],
      }),
      mapError: mapToolIpcError,
    }),
  );

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
        const response = service.resolveApproval(request.payload);
        if (response.events) {
          void forwardRuntimeEvents(event.sender, response.events, { logger: options.logger });
        }
        return { approval: response.approval };
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


