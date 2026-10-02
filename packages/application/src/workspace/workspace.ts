/*
 * Defines stable Workspace identity, root, status, time, and lifecycle facts.
 */
export type WorkspaceStatus = 'available' | 'missing';

export interface Workspace {
  workspace_id: string;
  name: string;
  root_path: string;
  root_path_key: string;
  status: WorkspaceStatus;
  created_at: string;
  updated_at: string;
  last_opened_at: string;
}

export interface OpenWorkspaceRequest { root_path: string }
export interface WorkspaceFailure {
  code: 'workspace_path_missing' | 'workspace_path_not_directory' | 'workspace_path_invalid' | 'workspace_repository_error';
  message: string;
}
export type OpenWorkspaceResult =
  | { status: 'opened'; workspace: Workspace }
  | { status: 'failed'; failure: WorkspaceFailure };

export interface ActivateWorkspaceRequest { workspace_id: string }
export type ActivateWorkspaceResult =
  | { status: 'activated'; workspace: Workspace }
  | { status: 'not_found'; workspace_id: string }
  | { status: 'failed'; failure: WorkspaceFailure };

export interface GetWorkspaceRequest { workspace_id: string }
export type GetWorkspaceResult =
  | { status: 'found'; workspace: Workspace }
  | { status: 'not_found'; workspace_id: string };

export interface ListWorkspacesRequest { refresh_status?: boolean }
export interface ListWorkspacesResult { workspaces: Workspace[] }
export interface RemoveWorkspaceRequest { workspace_id: string }
export type RemoveWorkspaceResult =
  | { status: 'removed'; workspace_id: string }
  | { status: 'not_found'; workspace_id: string }
  | { status: 'blocked'; workspace_id: string; reason: 'workspace_has_business_facts' };

export interface ListAuthorizedWorkspaceRootsResult {
  roots: Array<{ workspace_id: string; root_path: string }>;
}
