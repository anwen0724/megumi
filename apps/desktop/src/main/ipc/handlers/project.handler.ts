import { ipcMain } from 'electron';
import type { z } from 'zod';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { RuntimeIpcRequest } from '@megumi/shared/ipc-contracts';
import type { RuntimeIpcError } from '@megumi/shared/ipc-errors';
import type {
  ProjectListData,
  ProjectListPayload,
  ProjectOpenData,
  ProjectOpenPayload,
  ProjectRemoveData,
  ProjectRemovePayload,
  ProjectUseExistingData,
  ProjectUseExistingPayload,
} from '@megumi/shared/ipc-schemas';
import {
  ProjectListRequestSchema,
  ProjectOpenRequestSchema,
  ProjectRemoveRequestSchema,
  ProjectUseExistingRequestSchema,
} from '@megumi/shared/ipc-schemas';
import type { ProjectService } from '../../services/project.service';
import { ProjectPathValidationError } from '../../services/project.service';
import type { RuntimeLogger } from '../../services/runtime-logger.service';
import { createRuntimeIpcHandler } from '../runtime-ipc-handler';

export type ProjectHandlersService = Pick<
  ProjectService,
  'listProjects' | 'useExistingProject' | 'openProject' | 'removeProject'
>;

export interface RegisterProjectHandlersOptions {
  logger?: RuntimeLogger;
}

export function registerProjectHandlers(
  service: ProjectHandlersService,
  options: RegisterProjectHandlersOptions = {},
): void {
  ipcMain.handle(
    IPC_CHANNELS.project.list,
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.project.list,
      requestSchema: ProjectListRequestSchema as z.ZodType<
        RuntimeIpcRequest<ProjectListPayload, typeof IPC_CHANNELS.project.list>
      >,
      logger: options.logger,
      handle: async (): Promise<ProjectListData> => ({
        projects: await service.listProjects(),
      }),
      mapError: mapProjectIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.project.useExisting,
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.project.useExisting,
      requestSchema: ProjectUseExistingRequestSchema as z.ZodType<
        RuntimeIpcRequest<ProjectUseExistingPayload, typeof IPC_CHANNELS.project.useExisting>
      >,
      logger: options.logger,
      handle: async (): Promise<ProjectUseExistingData> => service.useExistingProject(),
      mapError: mapProjectIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.project.open,
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.project.open,
      requestSchema: ProjectOpenRequestSchema as z.ZodType<
        RuntimeIpcRequest<ProjectOpenPayload, typeof IPC_CHANNELS.project.open>
      >,
      logger: options.logger,
      handle: async (
        request: RuntimeIpcRequest<ProjectOpenPayload, typeof IPC_CHANNELS.project.open>,
      ): Promise<ProjectOpenData> => ({
        project: await service.openProject(request.payload),
      }),
      mapError: mapProjectIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.project.remove,
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.project.remove,
      requestSchema: ProjectRemoveRequestSchema as z.ZodType<
        RuntimeIpcRequest<ProjectRemovePayload, typeof IPC_CHANNELS.project.remove>
      >,
      logger: options.logger,
      handle: (
        request: RuntimeIpcRequest<ProjectRemovePayload, typeof IPC_CHANNELS.project.remove>,
      ): ProjectRemoveData => service.removeProject(request.payload),
      mapError: mapProjectIpcError,
    }),
  );
}

function mapProjectIpcError(error: unknown): RuntimeIpcError {
  if (error instanceof ProjectPathValidationError) {
    return {
      code: 'filesystem_error',
      message: 'Megumi could not use that project folder.',
      severity: 'error',
      retryable: false,
      source: 'main',
      details: {
        reason: error.reason,
      },
    };
  }

  return {
    code: 'ipc_handler_failed',
    message: 'Project service failed.',
    severity: 'error',
    retryable: true,
    source: 'main',
  };
}
