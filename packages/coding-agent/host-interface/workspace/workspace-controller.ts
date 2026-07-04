// Controller for workspace operations exposed to UI shells.
import type {
  ProjectListData,
  ProjectOpenData,
  ProjectOpenPayload,
  ProjectRemoveData,
  ProjectRemovePayload,
  ProjectRecord,
  ProjectUseExistingData,
} from '@megumi/shared/project';
import type { Workspace, WorkspaceService } from '../../workspace';

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
  listProjects(): Promise<ProjectListData['projects']>;
  useExistingProject(): Promise<ProjectUseExistingData>;
  openProject(payload: ProjectOpenPayload): Promise<ProjectOpenData['project']>;
  removeProject(payload: ProjectRemovePayload): ProjectRemoveData;
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
      return result.workspaces.map(projectFromWorkspace);
    },

    async useExistingProject() {
      const picked = await input.directoryPicker?.chooseDirectory();
      if (!picked || picked.canceled || picked.filePaths.length === 0) {
        return { cancelled: true };
      }

      const opened = await input.workspaceService.openWorkspace({
        root_path: picked.filePaths[0],
        opened_at: now(),
      });
      if (opened.status === 'failed') {
        throw compatibilityErrorFromFailure(picked.filePaths[0], opened.failure.code);
      }
      return {
        cancelled: false,
        project: projectFromWorkspace(opened.workspace),
      };
    },

    async openProject(payload) {
      const found = input.workspaceService.getWorkspace({ workspace_id: payload.projectId });
      if (found.status === 'not_found') {
        throw new WorkspaceProjectCompatibilityError(payload.projectId, 'missing');
      }
      return projectFromWorkspace(found.workspace);
    },

    removeProject(payload) {
      const result = input.workspaceService.removeWorkspace({ workspace_id: payload.projectId });
      return {
        projectId: payload.projectId,
        removed: result.status === 'removed',
      };
    },

    listAuthorizedWorkspaceRoots() {
      return input.workspaceService.listAuthorizedWorkspaceRoots().roots.map((root) => root.root_path);
    },
  };
}

function projectFromWorkspace(workspace: Workspace): ProjectRecord {
  return {
    projectId: workspace.workspace_id,
    name: workspace.name,
    repoPath: workspace.root_path,
    repoPathKey: workspace.root_path_key,
    status: workspace.status,
    createdAt: workspace.created_at,
    lastOpenedAt: workspace.last_opened_at,
  };
}

function compatibilityErrorFromFailure(pathOrId: string, code: string): WorkspaceProjectCompatibilityError {
  return new WorkspaceProjectCompatibilityError(
    pathOrId,
    code === 'workspace_path_not_directory' ? 'not_directory' : 'missing',
  );
}
