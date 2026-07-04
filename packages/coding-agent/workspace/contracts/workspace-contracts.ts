/*
 * Public Workspace lifecycle and path-policy contracts for the Coding Agent
 * product core. These types define the Workspace module surface consumed by
 * host-interface, composition, tools, and tests.
 */

export type WorkspaceStatus = 'available' | 'missing';

export type Workspace = {
  workspace_id: string;
  name: string;
  root_path: string;
  root_path_key: string;
  status: WorkspaceStatus;
  created_at: string;
  updated_at: string;
  last_opened_at: string;
};

export type OpenWorkspaceRequest = {
  root_path: string;
  opened_at: string;
};

export type WorkspaceFailure = {
  code: 'workspace_path_missing' | 'workspace_path_not_directory' | 'workspace_path_invalid' | 'workspace_repository_error';
  message: string;
};

export type OpenWorkspaceResult =
  | { status: 'opened'; workspace: Workspace }
  | { status: 'failed'; failure: WorkspaceFailure };

export type GetWorkspaceRequest = {
  workspace_id: string;
};

export type GetWorkspaceResult =
  | { status: 'found'; workspace: Workspace }
  | { status: 'not_found'; workspace_id: string };

export type ListWorkspacesRequest = {
  refresh_status?: boolean;
};

export type ListWorkspacesResult = {
  workspaces: Workspace[];
};

export type RemoveWorkspaceRequest = {
  workspace_id: string;
};

export type RemoveWorkspaceResult =
  | { status: 'removed'; workspace_id: string }
  | { status: 'not_found'; workspace_id: string }
  | { status: 'blocked'; workspace_id: string; reason: 'workspace_has_business_facts' };

export type ListAuthorizedWorkspaceRootsResult = {
  roots: Array<{
    workspace_id: string;
    root_path: string;
  }>;
};

export type ClassifyWorkspacePathRequest = {
  workspace_root: string;
  target_path: string;
  platform?: NodeJS.Platform;
  protected_path_hints?: readonly string[];
};

export type WorkspacePathClassification = {
  absolute_path: string;
  workspace_path: string;
  inside_workspace: boolean;
  protected: boolean;
  sensitive: boolean;
};

export type ResolveWorkspacePathRequest = ClassifyWorkspacePathRequest;

export type ResolveWorkspacePathResult =
  | {
      status: 'resolved';
      absolute_path: string;
      workspace_path: string;
      protected: boolean;
      sensitive: boolean;
    }
  | { status: 'outside_workspace'; target_path: string };

export type AssertOrdinaryWorkspacePathRequest = ClassifyWorkspacePathRequest;

export type AssertOrdinaryWorkspacePathResult =
  | { status: 'ok'; absolute_path: string; workspace_path: string }
  | { status: 'rejected'; reason: 'outside_workspace' | 'protected_path' | 'sensitive_path' };

export interface WorkspaceService {
  openWorkspace(request: OpenWorkspaceRequest): Promise<OpenWorkspaceResult>;
  getWorkspace(request: GetWorkspaceRequest): GetWorkspaceResult;
  listWorkspaces(request?: ListWorkspacesRequest): Promise<ListWorkspacesResult>;
  removeWorkspace(request: RemoveWorkspaceRequest): RemoveWorkspaceResult;
  listAuthorizedWorkspaceRoots(): ListAuthorizedWorkspaceRootsResult;
}

export interface WorkspacePathPolicyService {
  classifyPath(request: ClassifyWorkspacePathRequest): WorkspacePathClassification;
  resolvePath(request: ResolveWorkspacePathRequest): ResolveWorkspacePathResult;
  assertOrdinaryPath(request: AssertOrdinaryWorkspacePathRequest): AssertOrdinaryWorkspacePathResult;
}
