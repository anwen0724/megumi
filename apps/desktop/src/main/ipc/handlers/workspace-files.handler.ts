import { ipcMain } from 'electron';
import { PathSandboxViolationError } from '@megumi/security/sandbox-policy';
import type { z } from 'zod';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { RuntimeIpcRequest } from '@megumi/shared/ipc-contracts';
import type { RuntimeIpcError } from '@megumi/shared/ipc-errors';
import type {
  WorkspaceFilesListData,
  WorkspaceFilesListPayload,
} from '@megumi/shared/ipc-schemas';
import { WorkspaceFilesListRequestSchema } from '@megumi/shared/ipc-schemas';
import type { WorkspaceFilesService } from '../../services/workspace-files.service';
import type { RuntimeLogger } from '../../services/runtime-logger.service';
import { createRuntimeIpcHandler } from '../runtime-ipc-handler';

export type WorkspaceFilesHandlersService = Pick<WorkspaceFilesService, 'listDirectory'>;
type WorkspaceFilesListRequest = RuntimeIpcRequest<
  WorkspaceFilesListPayload,
  typeof IPC_CHANNELS.workspace.files.list
>;

export interface RegisterWorkspaceFilesHandlersOptions {
  logger?: RuntimeLogger;
}

export function registerWorkspaceFilesHandlers(
  service: WorkspaceFilesHandlersService,
  options: RegisterWorkspaceFilesHandlersOptions = {},
): void {
  ipcMain.handle(
    IPC_CHANNELS.workspace.files.list,
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.workspace.files.list,
      requestSchema: WorkspaceFilesListRequestSchema as z.ZodType<WorkspaceFilesListRequest>,
      logger: options.logger,
      handle: (request: WorkspaceFilesListRequest): Promise<WorkspaceFilesListData> =>
        service.listDirectory(request.payload),
      mapError: mapWorkspaceFilesIpcError,
    }),
  );
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
