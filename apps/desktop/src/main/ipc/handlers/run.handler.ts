import { IPC_CHANNELS } from '@megumi/shared/ipc';
import type { RuntimeIpcRequest } from '@megumi/shared/ipc';
import type { RuntimeIpcError } from '@megumi/shared/ipc';
import type {
  RunEventsListData,
  RunEventsListPayload,
  RunListBySessionData,
  RunListBySessionPayload,
} from '@megumi/shared/ipc';
import { RunEventsListRequestSchema, RunListBySessionRequestSchema } from '@megumi/shared/ipc';
import type { SessionRunPort } from '@megumi/coding-agent/run';
import type { RuntimeLogger } from '../../services/agent-run/runtime-logger.service';
import { electronIpcMain, type DesktopIpcMain } from '../../shell/electron-ipc-main-host';
import { createIpcRequestHandler } from '../create-ipc-request-handler';

// Run IPC handlers code against the product SessionRunPort, narrowed to run queries.
export type RunHandlersService = Pick<SessionRunPort, 'listRunsBySession' | 'listRuntimeEventsByRun'>;

export interface RegisterRunHandlersOptions {
  logger?: RuntimeLogger;
  ipcMain?: DesktopIpcMain;
}

export function registerRunHandlers(
  service: RunHandlersService,
  options: RegisterRunHandlersOptions = {},
): void {
  const ipcMain = options.ipcMain ?? electronIpcMain;

  ipcMain.handle(
    IPC_CHANNELS.run.listBySession,
    createIpcRequestHandler({
      channel: IPC_CHANNELS.run.listBySession,
      requestSchema: RunListBySessionRequestSchema,
      logger: options.logger,
      handle: (
        request: RuntimeIpcRequest<RunListBySessionPayload, typeof IPC_CHANNELS.run.listBySession>,
      ): RunListBySessionData => ({
        runs: service.listRunsBySession(request.payload.sessionId),
      }),
      mapError: mapRunIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.run.events.list,
    createIpcRequestHandler({
      channel: IPC_CHANNELS.run.events.list,
      requestSchema: RunEventsListRequestSchema,
      logger: options.logger,
      handle: (
        request: RuntimeIpcRequest<RunEventsListPayload, typeof IPC_CHANNELS.run.events.list>,
      ): RunEventsListData => ({
        events: service.listRuntimeEventsByRun(request.payload.runId) as RunEventsListData['events'],
      }),
      mapError: mapRunIpcError,
    }),
  );
}

function mapRunIpcError(): RuntimeIpcError {
  return {
    code: 'ipc_handler_failed',
    message: 'Run service failed.',
    severity: 'error',
    retryable: true,
    source: 'main',
  };
}

