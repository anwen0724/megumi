import { IPC_CHANNELS } from '@megumi/shared/ipc';
import type { RuntimeIpcRequest } from '@megumi/shared/ipc';
import type { RuntimeIpcError } from '@megumi/shared/ipc';
import type {
  PlanByRunGetData,
  PlanByRunGetPayload,
  PlanStatusUpdateData,
  PlanStatusUpdatePayload,
} from '@megumi/shared/ipc';
import {
  PlanByRunGetRequestSchema,
  PlanStatusUpdateRequestSchema,
} from '@megumi/shared/ipc';
import type { HostArtifactController } from '@megumi/coding-agent/host-interface';
import type { RuntimeLogger } from '../../services/agent-run/runtime-logger.service';
import { electronIpcMain, type DesktopIpcMain } from '../../shell/electron-ipc-main-host';
import { createIpcRequestHandler } from '../create-ipc-request-handler';

export type PlanHandlersService = HostArtifactController['plan'];

export interface RegisterPlanHandlersOptions {
  logger?: RuntimeLogger;
  ipcMain?: DesktopIpcMain;
}

export function registerPlanHandlers(
  service: PlanHandlersService,
  options: RegisterPlanHandlersOptions = {},
): void {
  const ipcMain = options.ipcMain ?? electronIpcMain;

  ipcMain.handle(
    IPC_CHANNELS.plan.byRunGet,
    createIpcRequestHandler({
      channel: IPC_CHANNELS.plan.byRunGet,
      requestSchema: PlanByRunGetRequestSchema,
      logger: options.logger,
      handle: (
        request: RuntimeIpcRequest<PlanByRunGetPayload, typeof IPC_CHANNELS.plan.byRunGet>,
      ): PlanByRunGetData => service.getByRun(request.payload.runId),
      mapError: mapPlanIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.plan.statusUpdate,
    createIpcRequestHandler({
      channel: IPC_CHANNELS.plan.statusUpdate,
      requestSchema: PlanStatusUpdateRequestSchema,
      logger: options.logger,
      handle: (
        request: RuntimeIpcRequest<PlanStatusUpdatePayload, typeof IPC_CHANNELS.plan.statusUpdate>,
      ): PlanStatusUpdateData => service.updateStatus(request.payload),
      mapError: mapPlanIpcError,
    }),
  );




}

function mapPlanIpcError(): RuntimeIpcError {
  return {
    code: 'ipc_handler_failed',
    message: 'Agent plan service failed.',
    severity: 'error',
    retryable: true,
    source: 'main',
  };
}
