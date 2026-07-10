/*
 * Desktop IPC handlers for project/workspace operations and local file browsing.
 */
import {
  WorkspaceListFilesUiResultSchema,
  WorkspaceListProjectsUiResultSchema,
  WorkspaceOpenFileUiResultSchema,
  WorkspaceOpenProjectUiResultSchema,
  WorkspaceRemoveProjectUiResultSchema,
  WorkspaceUseExistingProjectUiResultSchema,
  type ProductHostInterface,
} from '@megumi/product/host-interface';
import type { RuntimeLogger } from '@megumi/product/logging';
import { electronIpcMain, type DesktopIpcMain } from '../../adapters/electron-ipc-main-adapter';
import { createIpcRequestHandler } from '../create-request-handler';
import { IPC_CHANNELS } from '../channels';
import type { RuntimeIpcError, RuntimeIpcRequest } from '../contracts';
import {
  ProjectListRequestSchema,
  ProjectOpenRequestSchema,
  ProjectRemoveRequestSchema,
  ProjectUseExistingRequestSchema,
  WorkspaceFileOpenRequestSchema,
  WorkspaceFilesListRequestSchema,
  type WorkspaceFileOpenPayload,
  type WorkspaceFilesListPayload,
} from '../schemas';

export interface WorkspaceHandlersService {
  host: Pick<ProductHostInterface, 'workspace'>;
}

export interface RegisterWorkspaceHandlersOptions {
  logger?: RuntimeLogger;
  ipcMain?: DesktopIpcMain;
}

export function registerWorkspaceHandlers(
  service: WorkspaceHandlersService,
  options: RegisterWorkspaceHandlersOptions = {},
): void {
  const ipcMain = options.ipcMain ?? electronIpcMain;

  ipcMain.handle(IPC_CHANNELS.workspace.projectList, createIpcRequestHandler({
    channel: IPC_CHANNELS.workspace.projectList,
    requestSchema: ProjectListRequestSchema,
    responseSchema: WorkspaceListProjectsUiResultSchema,
    logger: options.logger,
    handle: () => service.host.workspace.listProjects({}),
    mapError: mapWorkspaceIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.workspace.projectUseExisting, createIpcRequestHandler({
    channel: IPC_CHANNELS.workspace.projectUseExisting,
    requestSchema: ProjectUseExistingRequestSchema,
    responseSchema: WorkspaceUseExistingProjectUiResultSchema,
    logger: options.logger,
    handle: () => service.host.workspace.useExistingProject({}),
    mapError: mapWorkspaceIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.workspace.projectOpen, createIpcRequestHandler({
    channel: IPC_CHANNELS.workspace.projectOpen,
    requestSchema: ProjectOpenRequestSchema,
    responseSchema: WorkspaceOpenProjectUiResultSchema,
    logger: options.logger,
    handle: (request) => service.host.workspace.openProject(request.payload),
    mapError: mapWorkspaceIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.workspace.projectRemove, createIpcRequestHandler({
    channel: IPC_CHANNELS.workspace.projectRemove,
    requestSchema: ProjectRemoveRequestSchema,
    responseSchema: WorkspaceRemoveProjectUiResultSchema,
    logger: options.logger,
    handle: (request) => service.host.workspace.removeProject(request.payload),
    mapError: mapWorkspaceIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.workspace.filesList, createIpcRequestHandler({
    channel: IPC_CHANNELS.workspace.filesList,
    requestSchema: WorkspaceFilesListRequestSchema,
    responseSchema: WorkspaceListFilesUiResultSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<WorkspaceFilesListPayload, typeof IPC_CHANNELS.workspace.filesList>) =>
      service.host.workspace.listFiles(request.payload),
    mapError: mapWorkspaceIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.workspace.filesOpen, createIpcRequestHandler({
    channel: IPC_CHANNELS.workspace.filesOpen,
    requestSchema: WorkspaceFileOpenRequestSchema,
    responseSchema: WorkspaceOpenFileUiResultSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<WorkspaceFileOpenPayload, typeof IPC_CHANNELS.workspace.filesOpen>) =>
      service.host.workspace.openFile(request.payload),
    mapError: mapWorkspaceIpcError,
  }));
}

function mapWorkspaceIpcError(error: unknown): RuntimeIpcError {
  const details = error instanceof Error ? { message: error.message } : undefined;
  return {
    code: 'ipc_handler_failed',
    message: 'Workspace service failed.',
    severity: 'error',
    retryable: true,
    source: 'main',
    ...(details ? { details } : {}),
  };
}
