// Renderer-facing workspace DTOs.
export type WorkspaceDirectoryEntryKind = 'file' | 'directory';

export interface WorkspaceDirectoryEntry {
  name: string;
  relativePath: string;
  path?: string;
  kind: WorkspaceDirectoryEntryKind;
  depth: number;
  hidden?: boolean;
  ignored?: boolean;
  sizeBytes?: number;
  mtime?: string;
}

export interface WorkspaceFilesListPayload {
  workspaceRoot: string;
  directoryPath: string;
}

export interface WorkspaceFilesListData {
  workspaceRoot: string;
  directoryPath: string;
  entries: WorkspaceDirectoryEntry[];
}

export interface WorkspaceFileOpenPayload {
  workspaceRoot: string;
  filePath: string;
}

export interface WorkspaceFileOpenData {
  workspaceRoot: string;
  filePath: string;
  opened: true;
}

export type WorkspaceChangeKind = 'created' | 'modified' | 'deleted';
export type WorkspaceRestoreState = 'restorable' | 'restored' | 'conflict' | 'restore_failed' | 'not_restorable';

export interface WorkspaceChangeFooterFile {
  changedFileId: string;
  projectPath: string;
  changeKind: WorkspaceChangeKind;
  restoreState: WorkspaceRestoreState;
}

export interface WorkspaceChangeFooterChangeSet {
  changeSetId: string;
  changedFileCount: number;
  restorableCount: number;
  restoredCount: number;
  conflictCount: number;
  failedCount: number;
  hasRestorableChanges: boolean;
  files: WorkspaceChangeFooterFile[];
}

export interface WorkspaceChangeFooterFact {
  runId: string;
  sessionId: string;
  updatedAt: string;
  changeSets: WorkspaceChangeFooterChangeSet[];
}

export interface WorkspaceChangeSummary {
  changeSetId: string;
  sessionId?: string;
  runId?: string;
  workspaceId?: string;
  changedFileCount: number;
  status?: string;
}
