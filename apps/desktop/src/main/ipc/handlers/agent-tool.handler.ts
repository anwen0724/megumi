import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { RuntimeIpcRequest } from '@megumi/shared/ipc-contracts';
import type { RuntimeIpcError } from '@megumi/shared/ipc-errors';
import type {
  AgentApprovalResolveData,
  AgentApprovalResolvePayload,
  AgentToolCallGetData,
  AgentToolCallGetPayload,
  AgentToolDefinitionsListData,
  AgentToolDefinitionsListPayload,
  ApprovalResolveData,
  ApprovalResolvePayload,
  ToolCallGetData,
  ToolCallGetPayload,
  ToolDefinitionsListData,
  ToolDefinitionsListPayload,
} from '@megumi/shared/ipc-schemas';
import {
  AgentApprovalResolveRequestSchema,
  AgentToolCallGetRequestSchema,
  AgentToolDefinitionsListRequestSchema,
  ApprovalResolveRequestSchema,
  ToolCallGetRequestSchema,
  ToolDefinitionsListRequestSchema,
} from '@megumi/shared/ipc-schemas';
import type { RuntimeLogger } from '../../services/runtime-logger.service';
import type { AgentToolService } from '../../services/agent-tool.service';
import { createRuntimeIpcHandler } from '../runtime-ipc-handler';

export type AgentToolHandlersService = Pick<
  AgentToolService,
  'listDefinitions' | 'getToolCall' | 'resolveApproval'
>;

export interface RegisterAgentToolHandlersOptions {
  logger?: RuntimeLogger;
}

export function registerAgentToolHandlers(
  service: AgentToolHandlersService,
  options: RegisterAgentToolHandlersOptions = {},
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
      mapError: mapAgentToolIpcError,
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
      mapError: mapAgentToolIpcError,
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
      mapError: mapAgentToolIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.agent.tool.definitionsList,
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.agent.tool.definitionsList,
      requestSchema: AgentToolDefinitionsListRequestSchema,
      logger: options.logger,
      handle: (
        request: RuntimeIpcRequest<AgentToolDefinitionsListPayload, typeof IPC_CHANNELS.agent.tool.definitionsList>,
      ): AgentToolDefinitionsListData => ({
        tools: service.listDefinitions(request.payload),
      }),
      mapError: mapAgentToolIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.agent.tool.callGet,
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.agent.tool.callGet,
      requestSchema: AgentToolCallGetRequestSchema,
      logger: options.logger,
      handle: (
        request: RuntimeIpcRequest<AgentToolCallGetPayload, typeof IPC_CHANNELS.agent.tool.callGet>,
      ): AgentToolCallGetData => ({
        toolCall: service.getToolCall(request.payload.toolCallId),
      }),
      mapError: mapAgentToolIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.agent.approval.resolve,
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.agent.approval.resolve,
      requestSchema: AgentApprovalResolveRequestSchema,
      logger: options.logger,
      handle: (
        request: RuntimeIpcRequest<AgentApprovalResolvePayload, typeof IPC_CHANNELS.agent.approval.resolve>,
      ): AgentApprovalResolveData => ({
        approval: service.resolveApproval(request.payload),
      }),
      mapError: mapAgentToolIpcError,
    }),
  );
}

function mapAgentToolIpcError(): RuntimeIpcError {
  return {
    code: 'ipc_handler_failed',
    message: 'Agent tool service failed.',
    severity: 'error',
    retryable: true,
    source: 'main',
  };
}
