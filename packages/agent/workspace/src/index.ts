/*
 * Exposes stable Workspace facts, ports, and creation entry points.
 */
export { createWorkspaceChangeEventHandler } from './workspace-change-events';
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
  WorkspaceStatus,
} from './workspace';
export { createWorkspaceCatalog } from './workspace-catalog';
export type {
  CreateWorkspaceCatalogRequest,
  WorkspaceCatalog,
  WorkspaceCatalogFileSystem,
} from './workspace-catalog';
export {
  DEFAULT_PROTECTED_WORKSPACE_PATHS,
  DEFAULT_SENSITIVE_WORKSPACE_PATHS,
  createWorkspacePathPolicy,
} from './workspace-path-policy';
export type {
  AssertOrdinaryWorkspacePathRequest,
  AssertOrdinaryWorkspacePathResult,
  ClassifyWorkspacePathRequest,
  ResolveCanonicalWorkspacePathRequest,
  ResolveWorkspacePathRequest,
  ResolveWorkspacePathResult,
  WorkspaceCanonicalPathFileSystem,
  WorkspacePathClassification,
  WorkspacePathPolicy,
} from './workspace-path-policy';
export {
  DEFAULT_WORKSPACE_FILE_IGNORE_NAMES,
  createWorkspaceFiles,
} from './workspace-files';
export type {
  CreateWorkspaceFilesRequest,
  ListWorkspaceDirectoryRequest,
  ListWorkspaceDirectoryResult,
  ResolveWorkspaceFileRequest,
  ResolveWorkspaceFileResult,
  WorkspaceFileEntry,
  WorkspaceFiles,
  WorkspaceFilesFileSystem,
} from './workspace-files';
export { createWorkspaceChanges } from './workspace-changes';
export type {
  CreateWorkspaceChangesRequest,
  FinalizeWorkspaceChangeSetRequest,
  FinalizeWorkspaceChangeSetResult,
  GetWorkspaceChangeSummaryRequest,
  GetWorkspaceChangeSummaryResult,
  ListWorkspaceChangedFilesRequest,
  ListWorkspaceChangedFilesResult,
  ListWorkspaceChangeSummariesRequest,
  ListWorkspaceChangeSummariesResult,
  TrackWorkspaceToolExecutionRequest,
  WorkspaceChangeDiagnostic,
  WorkspaceChangeDiagnosticReason,
  WorkspaceChangeExecutionScope,
  WorkspaceChangeKind,
  WorkspaceEffectCoverage,
  WorkspaceEffectType,
  WorkspaceToolEffectReport,
  WorkspaceChangeSet,
  WorkspaceChangeSetStatus,
  WorkspaceChangeSummary,
  WorkspaceChangedFile,
  WorkspaceChanges,
} from './workspace-changes';
export type { WorkspaceStore } from './workspace-store';
