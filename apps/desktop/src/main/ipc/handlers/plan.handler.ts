import type { ImplementationPlanArtifactRecord } from '@megumi/shared/permission';
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
import type { PermissionSnapshotService } from '../../services/security/permission-snapshot.service';
import type { RuntimeLogger } from '../../services/runtime/runtime-logger.service';
import { electronIpcMain, type DesktopIpcMain } from '../../host/electron-ipc-main-host';
import { createRuntimeIpcHandler } from '../create-runtime-ipc-handler';

export type PlanHandlersService = Pick<
  PermissionSnapshotService,
  'getPlanByRun' | 'updatePlanStatus'
>;

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
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.plan.byRunGet,
      requestSchema: PlanByRunGetRequestSchema,
      logger: options.logger,
      handle: (
        request: RuntimeIpcRequest<PlanByRunGetPayload, typeof IPC_CHANNELS.plan.byRunGet>,
      ): PlanByRunGetData => ({
        plan: service.getPlanByRun(request.payload.runId) as ImplementationPlanArtifactRecord | undefined,
      }),
      mapError: mapPlanIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.plan.statusUpdate,
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.plan.statusUpdate,
      requestSchema: PlanStatusUpdateRequestSchema,
      logger: options.logger,
      handle: (
        request: RuntimeIpcRequest<PlanStatusUpdatePayload, typeof IPC_CHANNELS.plan.statusUpdate>,
      ): PlanStatusUpdateData => ({
        plan: service.updatePlanStatus(request.payload),
      }),
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



