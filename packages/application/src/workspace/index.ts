/*
 * Exposes stable Workspace facts, ports, and creation entry points.
 */
export {
  DEFAULT_PROTECTED_WORKSPACE_PATHS,
  DEFAULT_SENSITIVE_WORKSPACE_PATHS,
  createWorkspacePathPolicy
} from '@megumi/agent/sandbox/file-access';
export type {
  AssertOrdinaryWorkspacePathRequest,
  AssertOrdinaryWorkspacePathResult,
  ClassifyWorkspacePathRequest,
  ResolveCanonicalWorkspacePathRequest,
  ResolveWorkspacePathRequest,
  ResolveWorkspacePathResult,
  WorkspaceCanonicalPathFileSystem,
  WorkspacePathClassification,
  WorkspacePathPolicy
} from '@megumi/agent/sandbox/file-access';
export type {
  ActivateWorkspaceRequest,
  ActivateWorkspaceResult,
  GetWorkspaceRequest,
  GetWorkspaceResult,
  ListAuthorizedWorkspaceRootsResult,
  ListWorkspacesRequest,
  ListWorkspacesResult,
  OpenWorkspaceRequest,
  OpenWorkspaceResult,
  RemoveWorkspaceRequest,
  RemoveWorkspaceResult,
  Workspace,
  WorkspaceFailure,
  WorkspaceStatus
} from './workspace';
export { createWorkspaceCatalog } from './workspace-catalog';
export type {
  CreateWorkspaceCatalogRequest,
  WorkspaceCatalog,
  WorkspaceCatalogFileSystem
} from './workspace-catalog';
export { createWorkspaceChanges } from './workspace-changes';
export type {
  CreateWorkspaceChangesRequest,
  FinalizeWorkspaceChangeSetRequest,
  FinalizeWorkspaceChangeSetResult,
  GetWorkspaceChangeSummaryRequest,
  GetWorkspaceChangeSummaryResult, ListWorkspaceChangeSummariesRequest,
  ListWorkspaceChangeSummariesResult, ListWorkspaceChangedFilesRequest,
  ListWorkspaceChangedFilesResult, TrackWorkspaceToolExecutionRequest,
  WorkspaceChangeDiagnostic,
  WorkspaceChangeDiagnosticReason,
  WorkspaceChangeExecutionScope,
  WorkspaceChangeKind, WorkspaceChangeSet,
  WorkspaceChangeSetStatus,
  WorkspaceChangeSummary,
  WorkspaceChangedFile,
  WorkspaceChanges, WorkspaceEffectCoverage,
  WorkspaceEffectType,
  WorkspaceToolEffectReport
} from './workspace-changes';
export {
  DEFAULT_WORKSPACE_FILE_IGNORE_NAMES,
  createWorkspaceFiles
} from './workspace-files';
export type {
  CreateWorkspaceFilesRequest,
  ListWorkspaceDirectoryRequest,
  ListWorkspaceDirectoryResult,
  ResolveWorkspaceFileRequest,
  ResolveWorkspaceFileResult,
  WorkspaceFileEntry,
  WorkspaceFiles,
  WorkspaceFilesFileSystem
} from './workspace-files';
export type { WorkspaceStore } from './workspace-store';
