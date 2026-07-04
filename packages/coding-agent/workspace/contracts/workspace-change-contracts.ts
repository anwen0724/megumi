/*
 * Public Workspace change tracking contracts. Workspace records successful
 * managed file mutation facts only; restore, snapshots, diff content, and tool
 * execution lifecycle remain outside this module surface.
 */

export type WorkspaceChangeSetStatus = 'open' | 'finalized';
export type WorkspaceChangeKind = 'created' | 'modified' | 'deleted';

export type WorkspaceChangeSet = {
  change_set_id: string;
  workspace_id: string;
  session_id: string;
  run_id: string;
  status: WorkspaceChangeSetStatus;
  changed_file_count: number;
  created_at: string;
  finalized_at?: string;
};

export type WorkspaceChangedFile = {
  changed_file_id: string;
  change_set_id: string;
  workspace_path: string;
  change_kind: WorkspaceChangeKind;
  created_at: string;
};

export type WorkspaceChangeSummary = {
  change_set: WorkspaceChangeSet;
  files: WorkspaceChangedFile[];
};

export type WorkspaceChangeExecutionScope = {
  workspace_id: string;
  session_id: string;
  run_id: string;
  step_id?: string;
  tool_call_id?: string;
  tool_execution_id?: string;
};

export type WorkspaceToolExecution = {
  tool_name: string;
  input: unknown;
  workspace_root: string;
};

export type TrackWorkspaceToolExecutionRequest<T> = {
  scope?: WorkspaceChangeExecutionScope;
  tool_execution: WorkspaceToolExecution;
  execute: () => Promise<T>;
};

export type FinalizeWorkspaceChangeSetRequest = {
  workspace_id: string;
  session_id: string;
  run_id: string;
  step_id?: string;
  finalized_at: string;
};

export type FinalizeWorkspaceChangeSetResult =
  | { status: 'finalized'; change_set: WorkspaceChangeSet }
  | { status: 'not_found' };

export type GetWorkspaceChangeSummaryRequest = {
  change_set_id: string;
};

export type GetWorkspaceChangeSummaryResult =
  | { status: 'found'; summary: WorkspaceChangeSummary }
  | { status: 'not_found'; change_set_id: string };

export type ListWorkspaceChangedFilesRequest =
  | { by: 'change_set'; change_set_id: string }
  | { by: 'run'; run_id: string };

export type ListWorkspaceChangedFilesResult = {
  files: WorkspaceChangedFile[];
};

export interface WorkspaceChangeService {
  trackToolExecution<T>(request: TrackWorkspaceToolExecutionRequest<T>): Promise<T>;
  finalizeChangeSet(request: FinalizeWorkspaceChangeSetRequest): FinalizeWorkspaceChangeSetResult;
  getChangeSummary(request: GetWorkspaceChangeSummaryRequest): GetWorkspaceChangeSummaryResult;
  listChangedFiles(request: ListWorkspaceChangedFilesRequest): ListWorkspaceChangedFilesResult;
}
