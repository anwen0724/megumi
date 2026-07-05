/*
 * Host workspace controller. It maps UI project requests to Workspace Service calls.
 */
import type { Workspace, WorkspaceService } from '../../workspace';
import {
  toWorkspaceProjectUiDto,
} from '../mappers/workspace-ui-mapper';
import type {
  WorkspaceListProjectsUiRequest,
  WorkspaceListProjectsUiResult,
  WorkspaceOpenProjectUiRequest,
  WorkspaceOpenProjectUiResult,
  WorkspaceRemoveProjectUiRequest,
  WorkspaceRemoveProjectUiResult,
  WorkspaceUseExistingProjectUiRequest,
  WorkspaceUseExistingProjectUiResult,
} from '../contracts/workspace-ui-contracts';

export interface DirectoryPickerResult {
  canceled: boolean;
  filePaths: string[];
}

export interface DirectoryPickerPort {
  chooseDirectory(): Promise<DirectoryPickerResult>;
}

export class WorkspaceProjectCompatibilityError extends Error {
  constructor(
    readonly pathOrId: string,
    readonly reason: 'missing' | 'not_directory',
  ) {
    super(`Workspace project compatibility failed: ${reason}`);
    this.name = 'WorkspaceProjectCompatibilityError';
  }
}

export interface WorkspaceController {
  listProjects(request?: WorkspaceListProjectsUiRequest): Promise<WorkspaceListProjectsUiResult>;
  useExistingProject(request?: WorkspaceUseExistingProjectUiRequest): Promise<WorkspaceUseExistingProjectUiResult>;
  openProject(request: WorkspaceOpenProjectUiRequest): Promise<WorkspaceOpenProjectUiResult>;
  removeProject(request: WorkspaceRemoveProjectUiRequest): WorkspaceRemoveProjectUiResult;
  listAuthorizedWorkspaceRoots(): string[];
}

export function createWorkspaceController(input: {
  workspaceService: WorkspaceService;
  directoryPicker?: DirectoryPickerPort;
  now?: () => string;
}): WorkspaceController {
  const now = input.now ?? (() => new Date().toISOString());

  return {
    async listProjects() {
      const result = await input.workspaceService.listWorkspaces({ refresh_status: true });
      return { projects: result.workspaces.map(toWorkspaceProjectUiDto) };
    },

    async useExistingProject() {
      const picked = await input.directoryPicker?.chooseDirectory();
      if (!picked || picked.canceled || picked.filePaths.length === 0) {
        return { project: null };
      }

      const opened = await input.workspaceService.openWorkspace({
        root_path: picked.filePaths[0],
        opened_at: now(),
      });
      if (opened.status === 'failed') {
        throw compatibilityErrorFromFailure(picked.filePaths[0], opened.failure.code);
      }
      return { project: toWorkspaceProjectUiDto(opened.workspace) };
    },

    async openProject(request) {
      const found = input.workspaceService.getWorkspace({ workspace_id: request.projectId });
      if (found.status === 'not_found') {
        throw new WorkspaceProjectCompatibilityError(request.projectId, 'missing');
      }
      return { project: toWorkspaceProjectUiDto(found.workspace) };
    },

    removeProject(request) {
      const result = input.workspaceService.removeWorkspace({ workspace_id: request.projectId });
      return { removed: result.status === 'removed' };
    },

    listAuthorizedWorkspaceRoots() {
      return input.workspaceService.listAuthorizedWorkspaceRoots().roots.map((root) => root.root_path);
    },
  };
}

function compatibilityErrorFromFailure(pathOrId: string, code: string): WorkspaceProjectCompatibilityError {
  return new WorkspaceProjectCompatibilityError(
    pathOrId,
    code === 'workspace_path_not_directory' ? 'not_directory' : 'missing',
  );
}
