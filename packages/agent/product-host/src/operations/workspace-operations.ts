/*
 * Implements Product Workspace operations using Workspace and host capabilities.
 */
import type { Workspace, WorkspaceCatalog, WorkspaceFiles } from '@megumi/workspace';
import {
  type WorkspaceFileEntryUiDto,
  type WorkspaceHost,
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
} from '../host/workspace-host';
import type { DirectoryPicker } from '../host/capabilities/directory-picker';
import type { FileOpener } from '../host/capabilities/file-opener';

/** Creates the Product operations exposed through WorkspaceHost. */
export function createWorkspaceOperations(input: {
  workspaceService: WorkspaceCatalog;
  directoryPicker?: DirectoryPicker;
  workspaceFilesService: WorkspaceFiles;
  fileOpen?: FileOpener;
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

function toWorkspaceProjectUiDto(workspace: Workspace) {
  return {
    projectId: workspace.workspace_id,
    name: workspace.name,
    rootPath: workspace.root_path,
    status: workspace.status,
    createdAt: workspace.created_at,
    lastOpenedAt: workspace.last_opened_at,
  };
}

function toWorkspaceFileEntryUiDto(entry: {
  name: string;
  relative_path: string;
  type: 'file' | 'directory';
  depth: number;
  hidden: boolean;
  size_bytes?: number;
  modified_at: string;
}): WorkspaceFileEntryUiDto {
  return {
    name: entry.name,
    relativePath: entry.relative_path,
    type: entry.type,
    depth: entry.depth,
    hidden: entry.hidden,
    ...(entry.size_bytes === undefined ? {} : { sizeBytes: entry.size_bytes }),
    mtime: entry.modified_at,
  };
}

function toWorkspaceHostFailure(failure: { code: string; message: string }) {
  return { code: failure.code, message: failure.message };
}
