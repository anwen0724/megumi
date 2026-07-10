/*
 * Public Workspace lifecycle service. It validates workspace roots through an
 * injected file-system port and persists only Megumi Workspace records.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import type {
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
  WorkspaceService,
} from '../contracts/workspace-contracts';
import type { WorkspaceRepository } from '../repositories/workspace-repository';

type WorkspaceFileSystemPort = {
  stat(path: string): Promise<{ isDirectory(): boolean }>;
};

export interface CreateWorkspaceServiceOptions {
  repository: WorkspaceRepository;
  file_system: WorkspaceFileSystemPort;
  now?: () => string;
  platform?: NodeJS.Platform;
}

export function createWorkspaceService(options: CreateWorkspaceServiceOptions): WorkspaceService {
  const now = options.now ?? (() => new Date().toISOString());
  const platform = options.platform ?? process.platform;

  async function getPathStatus(root_path: string): Promise<Workspace['status']> {
    try {
      const stats = await options.file_system.stat(root_path);
      return stats.isDirectory() ? 'available' : 'missing';
    } catch {
      return 'missing';
    }
  }

  async function validateWorkspaceRoot(root_path: string): Promise<OpenWorkspaceResult | undefined> {
    try {
      const stats = await options.file_system.stat(root_path);
      if (!stats.isDirectory()) {
        return {
          status: 'failed',
          failure: {
            code: 'workspace_path_not_directory',
            message: `Workspace path is not a directory: ${root_path}`,
          },
        };
      }
    } catch {
      return {
        status: 'failed',
        failure: {
          code: 'workspace_path_missing',
          message: `Workspace path does not exist: ${root_path}`,
        },
      };
    }

    return undefined;
  }

  async function refreshWorkspaceStatus(workspace: Workspace): Promise<Workspace> {
    const status = await getPathStatus(workspace.root_path);
    if (status === workspace.status) {
      return workspace;
    }
    return options.repository.updateWorkspaceStatus({
      workspace_id: workspace.workspace_id,
      status,
      updated_at: now(),
    }) ?? workspace;
  }

  return {
    async openWorkspace(request: OpenWorkspaceRequest): Promise<OpenWorkspaceResult> {
      const openedAt = now();
      const normalizedRootPath = normalizeWorkspaceRootPath(request.root_path, platform);
      const validationFailure = await validateWorkspaceRoot(normalizedRootPath);
      if (validationFailure) {
        return validationFailure;
      }

      const rootPathKey = toWorkspaceRootPathKey(normalizedRootPath, platform);
      const existing = options.repository.findWorkspaceByRootPathKey(rootPathKey);
      const workspace: Workspace = {
        workspace_id: existing?.workspace_id ?? createWorkspaceIdFromRootPathKey(rootPathKey),
        name: basenameWorkspaceRootPath(normalizedRootPath, platform),
        root_path: normalizedRootPath,
        root_path_key: rootPathKey,
        status: 'available',
        created_at: existing?.created_at ?? openedAt,
        updated_at: openedAt,
        last_opened_at: openedAt,
      };

      return {
        status: 'opened',
        workspace: options.repository.insertOrUpdateWorkspace(workspace),
      };
    },

    async activateWorkspace(request): Promise<ActivateWorkspaceResult> {
      const workspace = options.repository.findWorkspaceById(request.workspace_id);
      if (!workspace) {
        return { status: 'not_found', workspace_id: request.workspace_id };
      }

      const activatedAt = now();
      const status = await getPathStatus(workspace.root_path);
      const activated = options.repository.insertOrUpdateWorkspace({
        ...workspace,
        status,
        updated_at: activatedAt,
        last_opened_at: activatedAt,
      });
      return { status: 'activated', workspace: activated };
    },

    getWorkspace(request: GetWorkspaceRequest): GetWorkspaceResult {
      const workspace = options.repository.findWorkspaceById(request.workspace_id);
      return workspace
        ? { status: 'found', workspace }
        : { status: 'not_found', workspace_id: request.workspace_id };
    },

    async listWorkspaces(request: ListWorkspacesRequest = {}): Promise<ListWorkspacesResult> {
      const workspaces = options.repository.listWorkspaces();
      if (!request.refresh_status) {
        return { workspaces };
      }
      return {
        workspaces: await Promise.all(workspaces.map(refreshWorkspaceStatus)),
      };
    },

    removeWorkspace(request: RemoveWorkspaceRequest): RemoveWorkspaceResult {
      const result = options.repository.deleteWorkspace(request.workspace_id);
      if (result === 'deleted') {
        return { status: 'removed', workspace_id: request.workspace_id };
      }
      if (result === 'blocked') {
        return {
          status: 'blocked',
          workspace_id: request.workspace_id,
          reason: 'workspace_has_business_facts',
        };
      }
      return { status: 'not_found', workspace_id: request.workspace_id };
    },

    listAuthorizedWorkspaceRoots(): ListAuthorizedWorkspaceRootsResult {
      return {
        roots: options.repository
          .listWorkspaces()
          .filter((workspace) => workspace.status === 'available')
          .map((workspace) => ({
            workspace_id: workspace.workspace_id,
            root_path: workspace.root_path,
          })),
      };
    },
  };
}

export function normalizeWorkspaceRootPath(root_path: string, platform: NodeJS.Platform = process.platform): string {
  return pathApiFor(platform).resolve(root_path);
}

export function toWorkspaceRootPathKey(root_path: string, platform: NodeJS.Platform = process.platform): string {
  const normalized = normalizeWorkspaceRootPath(root_path, platform);
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function createWorkspaceIdFromRootPathKey(root_path_key: string): string {
  const digest = crypto.createHash('sha256').update(root_path_key).digest('hex').slice(0, 16);
  return `workspace:${digest}`;
}

function basenameWorkspaceRootPath(root_path: string, platform: NodeJS.Platform): string {
  return pathApiFor(platform).basename(root_path);
}

function pathApiFor(platform: NodeJS.Platform): typeof path.win32 | typeof path.posix {
  return platform === 'win32' ? path.win32 : path.posix;
}
