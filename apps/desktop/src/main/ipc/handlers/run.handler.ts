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
import type { RuntimeEvent } from '@megumi/shared/runtime';
import type { Run } from '@megumi/shared/session';
import type { RuntimeLogger } from '../../services/agent-run/runtime-logger.service';
import { electronIpcMain, type DesktopIpcMain } from '../../shell/electron-ipc-main-host';
import { createIpcRequestHandler } from '../create-ipc-request-handler';

export interface RunHandlersSessionService {
  listRunsBySession(sessionId: string): Run[];
}

export interface RunHandlersAgentRunService {
  listRuntimeEventsByRun(runId: string): RuntimeEvent[];
}

export interface RunHandlersServices {
  sessionService: RunHandlersSessionService;
  agentRunService: RunHandlersAgentRunService;
}

export interface RegisterRunHandlersOptions {
  logger?: RuntimeLogger;
  ipcMain?: DesktopIpcMain;
}

export function registerRunHandlers(
  services: RunHandlersServices,
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
        runs: services.sessionService.listRunsBySession(request.payload.sessionId),
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
        events: services.agentRunService.listRuntimeEventsByRun(request.payload.runId) as RunEventsListData['events'],
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
