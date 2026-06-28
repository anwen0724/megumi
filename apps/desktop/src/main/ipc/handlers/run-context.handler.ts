import { IPC_CHANNELS } from '@megumi/shared/ipc';
import type { RuntimeIpcRequest } from '@megumi/shared/ipc';
import type { RuntimeIpcError } from '@megumi/shared/ipc';
import type {
  RunContextBaselineGetData,
  RunContextBaselineGetPayload,
  RunContextSourcesListData,
  RunContextSourcesListPayload,
} from '@megumi/shared/ipc';
import {
  RunContextBaselineGetRequestSchema,
  RunContextSourcesListRequestSchema,
} from '@megumi/shared/ipc';
import type { RunContextService } from '@megumi/coding-agent/context/resources';
import type { RuntimeLogger } from '../../services/agent-run/runtime-logger.service';
import { electronIpcMain, type DesktopIpcMain } from '../../shell/electron-ipc-main-host';
import { createIpcRequestHandler } from '../create-ipc-request-handler';

export type RunContextHandlersService = Pick<
  RunContextService,
  'getBaselineContext' | 'listWorkspaceSourcesByRun'
>;

export interface RegisterRunContextHandlersOptions {
  logger?: RuntimeLogger;
  ipcMain?: DesktopIpcMain;
}

export function registerRunContextHandlers(
  service: RunContextHandlersService,
  options: RegisterRunContextHandlersOptions = {},
): void {
  const ipcMain = options.ipcMain ?? electronIpcMain;

  ipcMain.handle(
    IPC_CHANNELS.runContext.baselineGet,
    createIpcRequestHandler({
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
    createIpcRequestHandler({
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

