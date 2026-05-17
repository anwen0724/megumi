import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { RuntimeIpcRequest } from '@megumi/shared/ipc-contracts';
import type { RuntimeIpcError } from '@megumi/shared/ipc-errors';
import type {
  ApprovalResolveData,
  ApprovalResolvePayload,
  ToolCallGetData,
  ToolCallGetPayload,
  ToolDefinitionsListData,
  ToolDefinitionsListPayload,
} from '@megumi/shared/ipc-schemas';
import {
  ApprovalResolveRequestSchema,
  ToolCallGetRequestSchema,
  ToolDefinitionsListRequestSchema,
} from '@megumi/shared/ipc-schemas';
import type { RuntimeLogger } from '../../services/runtime-logger.service';
import type { ToolService } from '../../services/tool.service';
import { createRuntimeIpcHandler } from '../runtime-ipc-handler';

export type ToolHandlersService = Pick<
  ToolService,
  'listDefinitions' | 'getToolCall' | 'resolveApproval'
>;

export interface RegisterToolHandlersOptions {
  logger?: RuntimeLogger;
}

export function registerToolHandlers(
  service: ToolHandlersService,
  options: RegisterToolHandlersOptions = {},
): void {
  ipcMain.handle(
    IPC_CHANNELS.tool.definitionsList,
    createRuntimeIpcHandler({
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
    IPC_CHANNELS.tool.callGet,
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.tool.callGet,
      requestSchema: ToolCallGetRequestSchema,
      logger: options.logger,
      handle: (
        request: RuntimeIpcRequest<ToolCallGetPayload, typeof IPC_CHANNELS.tool.callGet>,
      ): ToolCallGetData => ({
        toolCall: service.getToolCall(request.payload.toolCallId),
      }),
      mapError: mapToolIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.approval.resolve,
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.approval.resolve,
      requestSchema: ApprovalResolveRequestSchema,
      logger: options.logger,
      handle: (
        request: RuntimeIpcRequest<ApprovalResolvePayload, typeof IPC_CHANNELS.approval.resolve>,
      ): ApprovalResolveData => ({
        approval: service.resolveApproval(request.payload),
      }),
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
