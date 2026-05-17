import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { RuntimeIpcRequest } from '@megumi/shared/ipc-contracts';
import type { RuntimeIpcError } from '@megumi/shared/ipc-errors';
import type { RunEventsListData, RunEventsListPayload } from '@megumi/shared/ipc-schemas';
import { RunEventsListRequestSchema } from '@megumi/shared/ipc-schemas';
import type { SessionRunService } from '../../services/session-run.service';
import type { RuntimeLogger } from '../../services/runtime-logger.service';
import { createRuntimeIpcHandler } from '../runtime-ipc-handler';

export type RunHandlersService = Pick<SessionRunService, 'listRuntimeEventsByRun'>;

export interface RegisterRunHandlersOptions {
  logger?: RuntimeLogger;
}

export function registerRunHandlers(
  service: RunHandlersService,
  options: RegisterRunHandlersOptions = {},
): void {
  ipcMain.handle(
    IPC_CHANNELS.run.events.list,
    createRuntimeIpcHandler({
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
