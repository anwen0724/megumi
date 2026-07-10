import type {
  Workspace,
  WorkspaceFilesService,
  WorkspaceService,
} from '../../coding-agent/workspace';

/*
 * Implements WorkspaceHost over the Coding Agent Workspace module and host ports.
 */

export interface DirectoryPickerResult {
  canceled: boolean;
  filePaths: string[];
}

export interface DirectoryPickerPort {
  chooseDirectory(): Promise<DirectoryPickerResult>;
}

export interface FileOpenPort {
  openPath(absolutePath: string): Promise<string>;
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

export interface WorkspaceHost {
  listProjects(request?: WorkspaceListProjectsUiRequest): Promise<WorkspaceListProjectsUiResult>;
  useExistingProject(request?: WorkspaceUseExistingProjectUiRequest): Promise<WorkspaceUseExistingProjectUiResult>;
  openProject(request: WorkspaceOpenProjectUiRequest): Promise<WorkspaceOpenProjectUiResult>;
  removeProject(request: WorkspaceRemoveProjectUiRequest): WorkspaceRemoveProjectUiResult;
  listAuthorizedWorkspaceRoots(): string[];
  listFiles(request: WorkspaceListFilesUiRequest): Promise<WorkspaceListFilesUiResult>;
  openFile(request: WorkspaceOpenFileUiRequest): Promise<WorkspaceOpenFileUiResult>;
}

export function createWorkspaceHost(input: {
  workspaceService: WorkspaceService;
  directoryPicker?: DirectoryPickerPort;
  workspaceFilesService: WorkspaceFilesService;
  fileOpen?: FileOpenPort;
  now?: () => string;
}): WorkspaceHost {
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

    async listFiles(request) {
      const result = await input.workspaceFilesService.listDirectory({
        workspace_id: request.projectId,
        directory_path: request.directoryPath,
      });
      if (result.status !== 'ok') throw workspaceFilesError(result);
      return {
        projectId: result.workspace_id,
        workspaceRoot: result.workspace_root,
        directoryPath: result.directory_path,
        entries: result.entries.map((entry) => ({
          name: entry.name,
          relativePath: entry.relative_path,
          type: entry.type,
          depth: entry.depth,
          hidden: entry.hidden,
          ignored: false,
          ...(entry.size_bytes === undefined ? {} : { sizeBytes: entry.size_bytes }),
          mtime: entry.modified_at,
        })),
      };
    },

    async openFile(request) {
      const result = input.workspaceFilesService.resolveFile({
        workspace_id: request.projectId,
        file_path: request.filePath,
      });
      if (result.status !== 'ok') throw workspaceFilesError(result);
      if (!input.fileOpen) throw new Error('File open adapter is not configured.');
      const openError = await input.fileOpen.openPath(result.absolute_path);
      if (openError) throw new Error(openError);
      return {
        projectId: result.workspace_id,
        workspaceRoot: result.workspace_root,
        filePath: result.file_path,
        opened: true,
      };
    },
  };
}

function workspaceFilesError(result: { status: string }): Error {
  return new Error(result.status === 'workspace_not_found' ? 'Workspace not found.' : 'Workspace path was rejected.');
}

function compatibilityErrorFromFailure(pathOrId: string, code: string): WorkspaceProjectCompatibilityError {
  return new WorkspaceProjectCompatibilityError(
    pathOrId,
    code === 'workspace_path_not_directory' ? 'not_directory' : 'missing',
  );
}

/*
 * Workspace/project UI DTOs exposed by the host interface.
 */
export type WorkspaceProjectUiStatus = 'available' | 'missing';

export interface WorkspaceProjectUiDto {
  projectId: string;
  name: string;
  rootPath: string;
  rootPathKey: string;
  status: WorkspaceProjectUiStatus;
  openedAt?: string;
  lastActiveAt?: string;
}

export interface WorkspaceListProjectsUiRequest {}
export interface WorkspaceListProjectsUiResult {
  projects: WorkspaceProjectUiDto[];
}

export interface WorkspaceUseExistingProjectUiRequest {}
export interface WorkspaceUseExistingProjectUiResult {
  project: WorkspaceProjectUiDto | null;
}

export interface WorkspaceOpenProjectUiRequest {
  projectId: string;
}
export interface WorkspaceOpenProjectUiResult {
  project: WorkspaceProjectUiDto;
}

export interface WorkspaceRemoveProjectUiRequest {
  projectId: string;
}
export interface WorkspaceRemoveProjectUiResult {
  removed: boolean;
}

export interface WorkspaceFileEntryUiDto {
  name: string;
  relativePath: string;
  type: 'file' | 'directory';
  depth: number;
  hidden: boolean;
  ignored: boolean;
  sizeBytes?: number;
  mtime: string;
}

export interface WorkspaceListFilesUiRequest {
  projectId: string;
  directoryPath: string;
}
export interface WorkspaceListFilesUiResult {
  projectId: string;
  workspaceRoot: string;
  directoryPath: string;
  entries: WorkspaceFileEntryUiDto[];
}

export interface WorkspaceOpenFileUiRequest {
  projectId: string;
  filePath: string;
}
export interface WorkspaceOpenFileUiResult {
  projectId: string;
  workspaceRoot: string;
  filePath: string;
  opened: true;
}

/*
 * Maps Workspace module facts into host-facing workspace UI DTOs.
 */


export function toWorkspaceProjectUiDto(workspace: Workspace): WorkspaceProjectUiDto {
  return {
    projectId: workspace.workspace_id,
    name: workspace.name,
    rootPath: workspace.root_path,
    rootPathKey: workspace.root_path_key,
    status: workspace.status,
    openedAt: workspace.created_at,
    lastActiveAt: workspace.last_opened_at,
  };
}
