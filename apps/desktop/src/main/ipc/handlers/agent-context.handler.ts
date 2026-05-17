import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { RuntimeIpcRequest } from '@megumi/shared/ipc-contracts';
import type { RuntimeIpcError } from '@megumi/shared/ipc-errors';
import type {
  AgentContextBaselineGetData,
  AgentContextBaselineGetPayload,
  AgentContextSourcesListData,
  AgentContextSourcesListPayload,
  RunContextBaselineGetData,
  RunContextBaselineGetPayload,
  RunContextSourcesListData,
  RunContextSourcesListPayload,
} from '@megumi/shared/ipc-schemas';
import {
  AgentContextBaselineGetRequestSchema,
  AgentContextSourcesListRequestSchema,
  RunContextBaselineGetRequestSchema,
  RunContextSourcesListRequestSchema,
} from '@megumi/shared/ipc-schemas';
import type { AgentContextService } from '../../services/agent-context.service';
import type { RuntimeLogger } from '../../services/runtime-logger.service';
import { createRuntimeIpcHandler } from '../runtime-ipc-handler';

export type AgentContextHandlersService = Pick<
  AgentContextService,
  'getBaselineContext' | 'listWorkspaceSourcesByRun'
>;

export interface RegisterAgentContextHandlersOptions {
  logger?: RuntimeLogger;
}

export function registerAgentContextHandlers(
  service: AgentContextHandlersService,
  options: RegisterAgentContextHandlersOptions = {},
): void {
  ipcMain.handle(
    IPC_CHANNELS.runContext.baselineGet,
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.runContext.baselineGet,
      requestSchema: RunContextBaselineGetRequestSchema,
      logger: options.logger,
      handle: (
        request: RuntimeIpcRequest<
          RunContextBaselineGetPayload,
          typeof IPC_CHANNELS.runContext.baselineGet
        >,
      ): RunContextBaselineGetData => ({
        context: service.getBaselineContext(request.payload.runId),
      }),
      mapError: mapAgentContextIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.runContext.sourcesList,
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.runContext.sourcesList,
      requestSchema: RunContextSourcesListRequestSchema,
      logger: options.logger,
      handle: (
        request: RuntimeIpcRequest<
          RunContextSourcesListPayload,
          typeof IPC_CHANNELS.runContext.sourcesList
        >,
      ): RunContextSourcesListData => ({
        sources: service.listWorkspaceSourcesByRun(request.payload.runId),
      }),
      mapError: mapAgentContextIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.agent.context.baselineGet,
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.agent.context.baselineGet,
      requestSchema: AgentContextBaselineGetRequestSchema,
      logger: options.logger,
      handle: (
        request: RuntimeIpcRequest<
          AgentContextBaselineGetPayload,
          typeof IPC_CHANNELS.agent.context.baselineGet
        >,
      ): AgentContextBaselineGetData => ({
        context: service.getBaselineContext(request.payload.runId),
      }),
      mapError: mapAgentContextIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.agent.context.sourcesList,
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.agent.context.sourcesList,
      requestSchema: AgentContextSourcesListRequestSchema,
      logger: options.logger,
      handle: (
        request: RuntimeIpcRequest<
          AgentContextSourcesListPayload,
          typeof IPC_CHANNELS.agent.context.sourcesList
        >,
      ): AgentContextSourcesListData => ({
        sources: service.listWorkspaceSourcesByRun(request.payload.runId),
      }),
      mapError: mapAgentContextIpcError,
    }),
  );
}

function mapAgentContextIpcError(): RuntimeIpcError {
  return {
    code: 'ipc_handler_failed',
    message: 'Agent context service failed.',
    severity: 'error',
    retryable: true,
    source: 'main',
  };
}
