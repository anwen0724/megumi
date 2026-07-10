/*
 * Desktop IPC handlers for project/workspace operations and local file browsing.
 */
import { PathSandboxViolationError } from '@megumi/coding-agent/adapters/local/security/sandbox-policy';
import type { ProductHostInterface } from '@megumi/product/host-interface';
import type { WorkspaceFilesService } from '../../services/workspace/workspace-files.service';
import type { RuntimeLogger } from '../../services/agent-run/runtime-logger.service';
import { electronIpcMain, type DesktopIpcMain } from '../../shell/electron-ipc-main-host';
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
  workspaceFilesService: Pick<WorkspaceFilesService, 'listDirectory' | 'openFile'>;
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
    logger: options.logger,
    handle: () => service.host.workspace.listProjects({}),
    mapError: mapWorkspaceIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.workspace.projectUseExisting, createIpcRequestHandler({
    channel: IPC_CHANNELS.workspace.projectUseExisting,
    requestSchema: ProjectUseExistingRequestSchema,
    logger: options.logger,
    handle: () => service.host.workspace.useExistingProject({}),
    mapError: mapWorkspaceIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.workspace.projectOpen, createIpcRequestHandler({
    channel: IPC_CHANNELS.workspace.projectOpen,
    requestSchema: ProjectOpenRequestSchema,
    logger: options.logger,
    handle: (request) => service.host.workspace.openProject(request.payload),
    mapError: mapWorkspaceIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.workspace.projectRemove, createIpcRequestHandler({
    channel: IPC_CHANNELS.workspace.projectRemove,
    requestSchema: ProjectRemoveRequestSchema,
    logger: options.logger,
    handle: (request) => service.host.workspace.removeProject(request.payload),
    mapError: mapWorkspaceIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.workspace.filesList, createIpcRequestHandler({
    channel: IPC_CHANNELS.workspace.filesList,
    requestSchema: WorkspaceFilesListRequestSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<WorkspaceFilesListPayload, typeof IPC_CHANNELS.workspace.filesList>) =>
      service.workspaceFilesService.listDirectory(request.payload),
    mapError: mapWorkspaceFilesIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.workspace.filesOpen, createIpcRequestHandler({
    channel: IPC_CHANNELS.workspace.filesOpen,
    requestSchema: WorkspaceFileOpenRequestSchema,
    logger: options.logger,
    handle: (request: RuntimeIpcRequest<WorkspaceFileOpenPayload, typeof IPC_CHANNELS.workspace.filesOpen>) =>
      service.workspaceFilesService.openFile(request.payload),
    mapError: mapWorkspaceFilesIpcError,
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

function mapWorkspaceFilesIpcError(error: unknown): RuntimeIpcError {
  if (!(error instanceof PathSandboxViolationError)) {
    return {
      code: 'ipc_handler_failed',
      message: 'Megumi could not list workspace files right now.',
      severity: 'error',
      retryable: true,
      source: 'main',
    };
  }

  return {
    code: 'workspace_path_denied',
    message: 'Megumi could not list that workspace directory.',
    severity: 'error',
    retryable: false,
    source: 'main',
  };
}
