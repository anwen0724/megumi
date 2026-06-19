// Owns workspace facts and host-facing file contracts without depending on Node or Electron.
import type { JsonObject } from '../shared';
import type {
  WorkspaceChangedFileId,
  WorkspaceChangeSetId,
  WorkspaceCheckpointId,
  WorkspaceId,
  WorkspaceRestoreFileResultId,
  WorkspaceRestoreRequestId,
  WorkspaceRestoreResultId,
} from './ids';

export type WorkspacePath = string & { readonly __brand: 'WorkspacePath' };
export type WorkspaceStatus = 'active' | 'archived';
export type WorkspaceChangeSetStatus = 'open' | 'finalized' | 'restored' | 'discarded';
export type WorkspaceCheckpointStatus = 'created' | 'restored' | 'invalidated' | 'discarded';
export type WorkspaceRestoreStatus = 'pending' | 'completed' | 'failed' | 'conflicted';
export type WorkspaceRestoreFileStatus = 'restored' | 'removed' | 'skipped' | 'conflict' | 'failed';
export type WorkspaceChangedFileRestoreState = 'not_restored' | 'restored' | 'conflicted';

export interface Workspace {
  id: WorkspaceId | string;
  projectRoot: string;
  name?: string;
  status: WorkspaceStatus;
  createdAt: string;
  updatedAt: string;
  metadata?: JsonObject;
}

export interface WorkspaceRootAuthorization {
  workspaceId: WorkspaceId | string;
  projectRoot: string;
  authorized: boolean;
  reason: 'current_working_directory' | 'allowed_project_root' | 'session_workspace_root' | 'unauthorized_root';
  createdAt: string;
}

export interface WorkspacePathFact {
  path: WorkspacePath;
  segments: string[];
  basename: string;
  extension?: string;
}

export interface WorkspaceDirectoryEntry {
  name: string;
  path: WorkspacePath;
  kind: 'file' | 'directory';
}

export interface WorkspaceFileMetadata {
  path: WorkspacePath;
  exists: boolean;
  size?: number;
  hash?: string;
  modifiedAt?: string;
}

export interface WorkspaceFileSnapshot {
  id?: string;
  path: WorkspacePath;
  exists: boolean;
  content?: string;
  contentRef?: string;
  hash?: string;
  size?: number;
  capturedAt: string;
  metadata?: JsonObject;
}

export interface WorkspaceFileHost {
  readTextFile(path: WorkspacePath): Promise<string>;
  writeTextFile(path: WorkspacePath, content: string): Promise<void>;
  deleteFile(path: WorkspacePath): Promise<void>;
  fileExists(path: WorkspacePath): Promise<boolean>;
  listDirectory(path: WorkspacePath): Promise<WorkspaceDirectoryEntry[]>;
  statFile?(path: WorkspacePath): Promise<WorkspaceFileMetadata>;
  glob?(pattern: WorkspacePath): Promise<WorkspacePath[]>;
  searchText?(input: { pattern: string; query: string }): Promise<Array<{ path: WorkspacePath; line: number; text: string }>>;
}

export type WorkspaceChangeOperation = 'write' | 'edit' | 'delete' | 'restore';

export interface WorkspaceChangedFile {
  id: WorkspaceChangedFileId | string;
  changeSetId: WorkspaceChangeSetId | string;
  path: WorkspacePath;
  operation: WorkspaceChangeOperation;
  before: WorkspaceFileSnapshot;
  after: WorkspaceFileSnapshot;
  restoreState: WorkspaceChangedFileRestoreState;
  createdAt: string;
  metadata?: JsonObject;
}

export type WorkspaceChangeRecord = WorkspaceChangedFile;

export interface WorkspaceChangeSet {
  id: WorkspaceChangeSetId | string;
  workspaceId: WorkspaceId | string;
  sessionId?: string;
  runId?: string;
  toolCallId?: string;
  toolExecutionId?: string;
  status: WorkspaceChangeSetStatus;
  changes: WorkspaceChangedFile[];
  createdAt: string;
  updatedAt: string;
  finalizedAt?: string;
  metadata?: JsonObject;
}

export interface WorkspaceCheckpoint {
  id: WorkspaceCheckpointId | string;
  workspaceId: WorkspaceId | string;
  runId?: string;
  changeSetId?: WorkspaceChangeSetId | string;
  label: string;
  status: WorkspaceCheckpointStatus;
  snapshots: WorkspaceFileSnapshot[];
  createdAt: string;
  updatedAt: string;
  metadata?: JsonObject;
}

export interface WorkspaceRestoreRequest {
  id: WorkspaceRestoreRequestId | string;
  workspaceId: WorkspaceId | string;
  checkpointId: WorkspaceCheckpointId | string;
  changeSetId?: WorkspaceChangeSetId | string;
  requestedBy: 'user' | 'system';
  status: WorkspaceRestoreStatus;
  createdAt: string;
  metadata?: JsonObject;
}

export interface WorkspaceRestoreFileResult {
  id: WorkspaceRestoreFileResultId | string;
  restoreResultId: WorkspaceRestoreResultId | string;
  path: WorkspacePath;
  status: WorkspaceRestoreFileStatus;
  conflictReason?: string;
  beforeRestore: WorkspaceFileSnapshot;
  afterRestore: WorkspaceFileSnapshot;
  error?: string;
  metadata?: JsonObject;
}

export interface WorkspaceRestoreResult {
  id: WorkspaceRestoreResultId | string;
  requestId: WorkspaceRestoreRequestId | string;
  checkpointId: WorkspaceCheckpointId | string;
  workspaceId: WorkspaceId | string;
  status: WorkspaceRestoreStatus;
  restoredCount: number;
  failedCount: number;
  fileResults: WorkspaceRestoreFileResult[];
  restoredFiles: WorkspaceFileSnapshot[];
  createdAt: string;
  completedAt: string;
  metadata?: JsonObject;
}

export interface WorkspaceChangeSummary {
  workspaceId: WorkspaceId | string;
  sessionId?: string;
  changeSetId: WorkspaceChangeSetId | string;
  changedFileCount: number;
  operations: WorkspaceChangeOperation[];
  paths: WorkspacePath[];
}

export interface WorkspaceContextFact {
  workspaceId: WorkspaceId | string;
  projectRootLabel: string;
  boundary: { kind: 'project_root'; authorized: boolean };
  selectedPaths?: WorkspacePath[];
  changeSummary?: WorkspaceChangeSummary;
}

export interface WorkspaceWriteInput {
  path: string;
  content: string;
}

export interface WorkspaceEditInput {
  path: string;
  oldText: string;
  newText: string;
}

export function createWorkspace(input: Omit<Workspace, 'status' | 'createdAt' | 'updatedAt'> & Partial<Workspace>): Workspace {
  if (!input.id) {
    throw new Error('Workspace id is required.');
  }
  if (!input.projectRoot) {
    throw new Error('Workspace projectRoot is required.');
  }
  return {
    status: input.status ?? 'active',
    createdAt: input.createdAt ?? new Date(0).toISOString(),
    updatedAt: input.updatedAt ?? input.createdAt ?? new Date(0).toISOString(),
    ...input,
  };
}

export function normalizeWorkspacePath(input: string): WorkspacePath {
  const normalized = input.replaceAll('\\', '/').trim();

  if (!normalized) {
    return '' as WorkspacePath;
  }
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error('Workspace path must be relative.');
  }

  const parts = normalized.split('/').filter((part) => part.length > 0 && part !== '.');
  if (parts.some((part) => part === '..')) {
    throw new Error('Workspace path cannot escape the project root.');
  }

  return parts.join('/') as WorkspacePath;
}

export function createWorkspacePathFact(input: string): WorkspacePathFact {
  const path = normalizeWorkspacePath(input);
  const segments = String(path).split('/').filter(Boolean);
  const basename = segments.at(-1) ?? '';
  const extensionIndex = basename.lastIndexOf('.');
  return {
    path,
    segments,
    basename,
    ...(extensionIndex > 0 ? { extension: basename.slice(extensionIndex) } : {}),
  };
}

export function createWorkspaceRootAuthorization(input: {
  workspace: Workspace;
  allowedRoots: string[];
  currentWorkingDirectory?: string;
  sessionWorkspaceRoots?: string[];
  createdAt: string;
}): WorkspaceRootAuthorization {
  const projectRoot = normalizeHostRoot(input.workspace.projectRoot);
  const cwd = input.currentWorkingDirectory ? normalizeHostRoot(input.currentWorkingDirectory) : undefined;
  const allowedRoots = input.allowedRoots.map(normalizeHostRoot);
  const sessionRoots = (input.sessionWorkspaceRoots ?? []).map(normalizeHostRoot);

  if (cwd && cwd === projectRoot) {
    return { workspaceId: input.workspace.id, projectRoot: input.workspace.projectRoot, authorized: true, reason: 'current_working_directory', createdAt: input.createdAt };
  }
  if (sessionRoots.includes(projectRoot)) {
    return { workspaceId: input.workspace.id, projectRoot: input.workspace.projectRoot, authorized: true, reason: 'session_workspace_root', createdAt: input.createdAt };
  }
  if (allowedRoots.includes(projectRoot)) {
    return { workspaceId: input.workspace.id, projectRoot: input.workspace.projectRoot, authorized: true, reason: 'allowed_project_root', createdAt: input.createdAt };
  }
  return { workspaceId: input.workspace.id, projectRoot: input.workspace.projectRoot, authorized: false, reason: 'unauthorized_root', createdAt: input.createdAt };
}

export function createWorkspaceContextFact(input: {
  workspace: Workspace;
  authorization?: WorkspaceRootAuthorization;
  selectedPaths?: string[];
  changeSummary?: WorkspaceChangeSummary;
}): WorkspaceContextFact {
  return {
    workspaceId: input.workspace.id,
    projectRootLabel: input.workspace.name ?? basenameFromRoot(input.workspace.projectRoot),
    boundary: { kind: 'project_root', authorized: input.authorization?.authorized ?? true },
    ...(input.selectedPaths ? { selectedPaths: input.selectedPaths.map(normalizeWorkspacePath) } : {}),
    ...(input.changeSummary ? { changeSummary: input.changeSummary } : {}),
  };
}

function normalizeHostRoot(value: string): string {
  return value.replaceAll('\\', '/').replace(/\/+$/g, '').toLowerCase();
}

function basenameFromRoot(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/\/+$/g, '');
  return normalized.split('/').at(-1) ?? normalized;
}
