import { ipcMain } from 'electron';
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
import type { RecoveryService } from '../../services/recovery.service';
import type { RuntimeLogger } from '../../services/runtime-logger.service';
import { createRuntimeIpcHandler } from '../runtime-ipc-handler';

export interface RegisterRecoveryHandlersOptions {
  logger?: RuntimeLogger;
}

export function registerRecoveryHandlers(
  service: RecoveryService,
  options: RegisterRecoveryHandlersOptions = {},
): void {
  ipcMain.handle(
    IPC_CHANNELS.recovery.recoverableRunsList,
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.recovery.recoverableRunsList,
      requestSchema: RecoverableRunListRequestSchema,
      logger: options.logger,
      handle: (): RecoverableRunListData => ({ runs: service.listRecoverableRuns() }),
      mapError: mapRecoveryIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.recovery.resume,
    createRuntimeIpcHandler({
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
    createRuntimeIpcHandler({
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
    createRuntimeIpcHandler({
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
    createRuntimeIpcHandler({
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

