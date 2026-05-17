import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { RuntimeIpcRequest } from '@megumi/shared/ipc-contracts';
import type { RuntimeIpcError } from '@megumi/shared/ipc-errors';
import type {
  RunContextBaselineGetData,
  RunContextBaselineGetPayload,
  RunContextSourcesListData,
  RunContextSourcesListPayload,
} from '@megumi/shared/ipc-schemas';
import {
  RunContextBaselineGetRequestSchema,
  RunContextSourcesListRequestSchema,
} from '@megumi/shared/ipc-schemas';
import type { RunContextService } from '../../services/run-context.service';
import type { RuntimeLogger } from '../../services/runtime-logger.service';
import { createRuntimeIpcHandler } from '../runtime-ipc-handler';

export type RunContextHandlersService = Pick<
  RunContextService,
  'getBaselineContext' | 'listWorkspaceSourcesByRun'
>;

export interface RegisterRunContextHandlersOptions {
  logger?: RuntimeLogger;
}

export function registerRunContextHandlers(
  service: RunContextHandlersService,
  options: RegisterRunContextHandlersOptions = {},
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
      mapError: mapRunContextIpcError,
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
      mapError: mapRunContextIpcError,
    }),
  );




}

function mapRunContextIpcError(): RuntimeIpcError {
  return {
    code: 'ipc_handler_failed',
    message: 'Run context service failed.',
    severity: 'error',
    retryable: true,
    source: 'main',
  };
}
