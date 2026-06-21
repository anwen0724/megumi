import { IPC_CHANNELS } from '@megumi/shared/ipc';
import type { RuntimeIpcRequest } from '@megumi/shared/ipc';
import type { RuntimeIpcError } from '@megumi/shared/ipc';
import type {
  RecoverableRunListData,
  RunCancelData,
  RunCancelPayload,
  RunResumeData,
  RunResumePayload,
  RunRetryData,
  RunRetryPayload,
  WorkspaceRestoreData,
} from '@megumi/shared/ipc';
import {
  RecoverableRunListRequestSchema,
  RunCancelRequestSchema,
  RunResumeRequestSchema,
  RunRetryRequestSchema,
  WorkspaceRestorePayloadSchema,
  WorkspaceRestoreRequestSchema,
} from '@megumi/shared/ipc';
import type { RecoveryService } from '../../services/runtime/recovery.service';
import type { RuntimeLogger } from '../../services/runtime/runtime-logger.service';
import { electronIpcMain, type DesktopIpcMain } from '../../host/electron-ipc-main-host';
import { createIpcRequestHandler } from '../create-ipc-request-handler';

export interface RegisterRecoveryHandlersOptions {
  logger?: RuntimeLogger;
  ipcMain?: DesktopIpcMain;
}

export function registerRecoveryHandlers(
  service: RecoveryService,
  options: RegisterRecoveryHandlersOptions = {},
): void {
  const ipcMain = options.ipcMain ?? electronIpcMain;

  ipcMain.handle(
    IPC_CHANNELS.recovery.recoverableRunsList,
    createIpcRequestHandler({
      channel: IPC_CHANNELS.recovery.recoverableRunsList,
      requestSchema: RecoverableRunListRequestSchema,
      logger: options.logger,
      handle: (): RecoverableRunListData => ({ runs: service.listRecoverableRuns() }),
      mapError: mapRecoveryIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.recovery.resume,
    createIpcRequestHandler({
      channel: IPC_CHANNELS.recovery.resume,
      requestSchema: RunResumeRequestSchema,
      logger: options.logger,
      handle: (
        request: RuntimeIpcRequest<RunResumePayload, typeof IPC_CHANNELS.recovery.resume>,
      ): RunResumeData => ({ request: service.resumeRun(request.payload) }),
      mapError: mapRecoveryIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.recovery.cancel,
    createIpcRequestHandler({
      channel: IPC_CHANNELS.recovery.cancel,
      requestSchema: RunCancelRequestSchema,
      logger: options.logger,
      handle: (
        request: RuntimeIpcRequest<RunCancelPayload, typeof IPC_CHANNELS.recovery.cancel>,
      ): RunCancelData => ({ request: service.cancelRun(request.payload) }),
      mapError: mapRecoveryIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.recovery.retry,
    createIpcRequestHandler({
      channel: IPC_CHANNELS.recovery.retry,
      requestSchema: RunRetryRequestSchema,
      logger: options.logger,
      handle: (
        request: RuntimeIpcRequest<RunRetryPayload, typeof IPC_CHANNELS.recovery.retry>,
      ): RunRetryData => ({ request: service.retryRun(request.payload) }),
      mapError: mapRecoveryIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.recovery.workspaceRestore,
    createIpcRequestHandler({
      channel: IPC_CHANNELS.recovery.workspaceRestore,
      requestSchema: WorkspaceRestoreRequestSchema,
      logger: options.logger,
      handle: (request): Promise<WorkspaceRestoreData> =>
        service.restoreWorkspaceChangeSet(WorkspaceRestorePayloadSchema.parse(request.payload)),
      mapError: mapRecoveryIpcError,
    }),
  );
}

function mapRecoveryIpcError(): RuntimeIpcError {
  return {
    code: 'ipc_handler_failed',
    message: 'Recovery service failed.',
    severity: 'error',
    retryable: true,
    source: 'main',
  };
}


