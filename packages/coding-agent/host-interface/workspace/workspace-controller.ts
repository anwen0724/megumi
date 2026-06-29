// Controller for workspace operations exposed to UI shells.
import type {
  ProjectListData,
  ProjectOpenData,
  ProjectOpenPayload,
  ProjectRemoveData,
  ProjectRemovePayload,
  ProjectUseExistingData,
} from '@megumi/shared/project';
import type { WorkspaceRestoreData, WorkspaceRestorePayload } from '@megumi/shared/ipc';
import type { RecoveryService } from '../../state';
import type { ProjectService } from '../../workspace';

export interface WorkspaceController {
  listProjects(): Promise<ProjectListData['projects']>;
  useExistingProject(): Promise<ProjectUseExistingData>;
  openProject(payload: ProjectOpenPayload): Promise<ProjectOpenData['project']>;
  removeProject(payload: ProjectRemovePayload): ProjectRemoveData;
  listAuthorizedWorkspaceRoots(): string[];
  restoreWorkspaceChangeSet(payload: WorkspaceRestorePayload): Promise<WorkspaceRestoreData>;
}

export function createWorkspaceController(input: {
  projectService: ProjectService;
  recoveryService: Pick<RecoveryService, 'restoreWorkspaceChangeSet'>;
}): WorkspaceController {
  return {
    listProjects: () => input.projectService.listProjects(),
    useExistingProject: () => input.projectService.useExistingProject(),
    openProject: (payload) => input.projectService.openProject(payload),
    removeProject: (payload) => input.projectService.removeProject(payload),
    listAuthorizedWorkspaceRoots: () => input.projectService.listAuthorizedWorkspaceRoots(),
    restoreWorkspaceChangeSet: (payload) => input.recoveryService.restoreWorkspaceChangeSet(payload),
  };
}
