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
