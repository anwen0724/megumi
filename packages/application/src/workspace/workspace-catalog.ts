/*
 * Implements Workspace open, activation, catalog queries, and authorized roots.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import type {
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
} from './workspace';
import type { WorkspaceStore } from './workspace-store';

export interface WorkspaceCatalog {
  openWorkspace(request: OpenWorkspaceRequest): Promise<OpenWorkspaceResult>;
  activateWorkspace(request: ActivateWorkspaceRequest): Promise<ActivateWorkspaceResult>;
  getWorkspace(request: GetWorkspaceRequest): GetWorkspaceResult;
  listWorkspaces(request?: ListWorkspacesRequest): Promise<ListWorkspacesResult>;
  removeWorkspace(request: RemoveWorkspaceRequest): RemoveWorkspaceResult;
  listAuthorizedWorkspaceRoots(): ListAuthorizedWorkspaceRootsResult;
}

export interface WorkspaceCatalogFileSystem {
  stat(path: string): Promise<{ isDirectory(): boolean }>;
}

export interface CreateWorkspaceCatalogRequest {
  store: Pick<
    WorkspaceStore,
    | 'upsertWorkspace'
    | 'findWorkspaceById'
    | 'findWorkspaceByRootPathKey'
    | 'listWorkspaces'
    | 'updateWorkspaceStatus'
    | 'deleteWorkspace'
  >;
  file_system: WorkspaceCatalogFileSystem;
  now?: () => string;
  platform?: NodeJS.Platform;
}

export function createWorkspaceCatalog(options: CreateWorkspaceCatalogRequest): WorkspaceCatalog {
  const now = options.now ?? (() => new Date().toISOString());
  const platform = options.platform ?? process.platform;

  async function getPathStatus(rootPath: string): Promise<Workspace['status']> {
    try {
      return (await options.file_system.stat(rootPath)).isDirectory() ? 'available' : 'missing';
    } catch {
      return 'missing';
    }
  }

  async function refreshStatus(workspace: Workspace): Promise<Workspace> {
    const status = await getPathStatus(workspace.root_path);
    if (status === workspace.status) return workspace;
    return options.store.updateWorkspaceStatus({
      workspace_id: workspace.workspace_id,
      status,
      updated_at: now(),
    }) ?? workspace;
  }

  return {
    async openWorkspace(request) {
      const openedAt = now();
      const rootPath = normalizeWorkspaceRootPath(request.root_path, platform);
      const validation = await validateWorkspaceRoot(rootPath, options.file_system);
      if (validation) return validation;
      const rootPathKey = toWorkspaceRootPathKey(rootPath, platform);
      try {
        const existing = options.store.findWorkspaceByRootPathKey(rootPathKey);
        const workspace: Workspace = {
          workspace_id: existing?.workspace_id ?? createWorkspaceIdFromRootPathKey(rootPathKey),
          name: basenameWorkspaceRootPath(rootPath, platform),
          root_path: rootPath,
          root_path_key: rootPathKey,
          status: 'available',
          created_at: existing?.created_at ?? openedAt,
          updated_at: openedAt,
          last_opened_at: openedAt,
        };
        return { status: 'opened', workspace: options.store.upsertWorkspace(workspace) };
      } catch {
        return repositoryFailure();
      }
    },

    async activateWorkspace(request) {
      try {
        const workspace = options.store.findWorkspaceById(request.workspace_id);
        if (!workspace) return { status: 'not_found', workspace_id: request.workspace_id };
        const activatedAt = now();
        return {
          status: 'activated',
          workspace: options.store.upsertWorkspace({
            ...workspace,
            status: await getPathStatus(workspace.root_path),
            updated_at: activatedAt,
            last_opened_at: activatedAt,
          }),
        };
      } catch {
        return repositoryFailure();
      }
    },

    getWorkspace(request) {
      const workspace = options.store.findWorkspaceById(request.workspace_id);
      return workspace
        ? { status: 'found', workspace }
        : { status: 'not_found', workspace_id: request.workspace_id };
    },

    async listWorkspaces(request = {}) {
      const workspaces = options.store.listWorkspaces();
      return {
        workspaces: request.refresh_status
          ? await Promise.all(workspaces.map(refreshStatus))
          : workspaces,
      };
    },

    removeWorkspace(request) {
      const result = options.store.deleteWorkspace(request.workspace_id);
      if (result === 'deleted') return { status: 'removed', workspace_id: request.workspace_id };
      if (result === 'blocked') {
        return {
          status: 'blocked',
          workspace_id: request.workspace_id,
          reason: 'workspace_has_business_facts',
        };
      }
      return { status: 'not_found', workspace_id: request.workspace_id };
    },

    listAuthorizedWorkspaceRoots() {
      return {
        roots: options.store.listWorkspaces()
          .filter((workspace) => workspace.status === 'available')
          .map((workspace) => ({
            workspace_id: workspace.workspace_id,
            root_path: workspace.root_path,
          })),
      };
    },
  };
}

export function normalizeWorkspaceRootPath(
  rootPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return pathApiFor(platform).resolve(rootPath);
}

export function toWorkspaceRootPathKey(
  rootPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const normalized = normalizeWorkspaceRootPath(rootPath, platform);
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function createWorkspaceIdFromRootPathKey(rootPathKey: string): string {
  const digest = crypto.createHash('sha256').update(rootPathKey).digest('hex').slice(0, 16);
  return `workspace:${digest}`;
}

async function validateWorkspaceRoot(
  rootPath: string,
  fileSystem: WorkspaceCatalogFileSystem,
): Promise<OpenWorkspaceResult | undefined> {
  try {
    if (!(await fileSystem.stat(rootPath)).isDirectory()) {
      return {
        status: 'failed',
        failure: {
          code: 'workspace_path_not_directory',
          message: `Workspace path is not a directory: ${rootPath}`,
        },
      };
    }
    return undefined;
  } catch {
    return {
      status: 'failed',
      failure: {
        code: 'workspace_path_missing',
        message: `Workspace path does not exist: ${rootPath}`,
      },
    };
  }
}

function repositoryFailure(): Extract<OpenWorkspaceResult, { status: 'failed' }> {
  return {
    status: 'failed',
    failure: {
      code: 'workspace_repository_error',
      message: 'Workspace repository operation failed.',
    },
  };
}

function basenameWorkspaceRootPath(rootPath: string, platform: NodeJS.Platform): string {
  return pathApiFor(platform).basename(rootPath);
}
function pathApiFor(platform: NodeJS.Platform): typeof path.win32 | typeof path.posix {
  return platform === 'win32' ? path.win32 : path.posix;
}
