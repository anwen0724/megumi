/*
 * Forwards Workspace Host requests to Workspace capabilities and host ports;
 * all stable DTOs, schemas, and pure mappings live in workspace-contract.
 */
import type { WorkspaceCatalog, WorkspaceFiles } from '@megumi/workspace';
import {
  toWorkspaceFileEntryUiDto,
  toWorkspaceHostFailure,
  toWorkspaceProjectUiDto,
  type DirectoryPickerPort,
  type FileOpenPort,
  type WorkspaceListFilesUiRequest,
  type WorkspaceListFilesUiResult,
  type WorkspaceListProjectsUiRequest,
  type WorkspaceListProjectsUiResult,
  type WorkspaceOpenFileUiRequest,
  type WorkspaceOpenFileUiResult,
  type WorkspaceOpenProjectUiRequest,
  type WorkspaceOpenProjectUiResult,
  type WorkspaceRemoveProjectUiRequest,
  type WorkspaceRemoveProjectUiResult,
  type WorkspaceUseExistingProjectUiRequest,
  type WorkspaceUseExistingProjectUiResult,
} from './workspace-contract';

export interface WorkspaceHost {
  listProjects(request?: WorkspaceListProjectsUiRequest): Promise<WorkspaceListProjectsUiResult>;
  useExistingProject(request?: WorkspaceUseExistingProjectUiRequest): Promise<WorkspaceUseExistingProjectUiResult>;
  openProject(request: WorkspaceOpenProjectUiRequest): Promise<WorkspaceOpenProjectUiResult>;
  removeProject(request: WorkspaceRemoveProjectUiRequest): WorkspaceRemoveProjectUiResult;
  listFiles(request: WorkspaceListFilesUiRequest): Promise<WorkspaceListFilesUiResult>;
  openFile(request: WorkspaceOpenFileUiRequest): Promise<WorkspaceOpenFileUiResult>;
}

export function createWorkspaceHost(input: {
  workspaceService: WorkspaceCatalog;
  directoryPicker?: DirectoryPickerPort;
  workspaceFilesService: WorkspaceFiles;
  fileOpen?: FileOpenPort;
}): WorkspaceHost {
  return {
    async listProjects() {
      const result = await input.workspaceService.listWorkspaces({ refresh_status: true });
      return { projects: result.workspaces.map(toWorkspaceProjectUiDto) };
    },

    async useExistingProject() {
      const picked = await input.directoryPicker?.chooseDirectory();
      if (!picked || picked.canceled || picked.filePaths.length === 0) {
        return { status: 'cancelled', project: null };
      }

      const result = await input.workspaceService.openWorkspace({ root_path: picked.filePaths[0] });
      return result.status === 'failed'
        ? { status: 'failed', failure: toWorkspaceHostFailure(result.failure) }
        : { status: 'opened', project: toWorkspaceProjectUiDto(result.workspace) };
    },

    async openProject(request) {
      const result = await input.workspaceService.activateWorkspace({ workspace_id: request.projectId });
      if (result.status === 'not_found') {
        return { status: 'not_found', projectId: result.workspace_id };
      }
      return result.status === 'failed'
        ? { status: 'failed', failure: toWorkspaceHostFailure(result.failure) }
        : { status: 'activated', project: toWorkspaceProjectUiDto(result.workspace) };
    },

    removeProject(request) {
      const result = input.workspaceService.removeWorkspace({ workspace_id: request.projectId });
      if (result.status === 'removed') {
        return { status: 'removed', projectId: result.workspace_id };
      }
      if (result.status === 'not_found') {
        return { status: 'not_found', projectId: result.workspace_id };
      }
      return { status: 'blocked', projectId: result.workspace_id, reason: result.reason };
    },

    async listFiles(request) {
      const result = await input.workspaceFilesService.listDirectory({
        workspace_id: request.projectId,
        directory_path: request.directoryPath,
      });
      if (result.status === 'workspace_not_found') {
        return { status: 'workspace_not_found', projectId: result.workspace_id };
      }
      if (result.status === 'path_rejected') {
        return { status: 'path_rejected', reason: result.reason };
      }
      return {
        status: 'ok',
        projectId: result.workspace_id,
        workspaceRoot: result.workspace_root,
        directoryPath: result.directory_path,
        entries: result.entries.map(toWorkspaceFileEntryUiDto),
      };
    },

    async openFile(request) {
      const result = await input.workspaceFilesService.resolveFile({
        workspace_id: request.projectId,
        file_path: request.filePath,
      });
      if (result.status === 'workspace_not_found') {
        return { status: 'workspace_not_found', projectId: result.workspace_id };
      }
      if (result.status === 'path_rejected') {
        return { status: 'path_rejected', reason: result.reason };
      }
      if (!input.fileOpen) {
        throw new Error('File open adapter is not configured.');
      }

      const opened = await input.fileOpen.openPath(result.absolute_path);
      if (opened.status === 'failed') {
        return {
          status: 'failed',
          projectId: result.workspace_id,
          filePath: result.file_path,
          failure: { code: 'file_open_failed', message: opened.message },
        };
      }
      return {
        status: 'opened',
        projectId: result.workspace_id,
        workspaceRoot: result.workspace_root,
        filePath: result.file_path,
      };
    },
  };
}
