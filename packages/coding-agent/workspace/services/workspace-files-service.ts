/*
 * Lists files for canonical Workspaces and resolves safe project-relative paths.
 * Host-specific file opening remains outside the Workspace module.
 */
import path from 'node:path';
import type {
  ListWorkspaceDirectoryResult,
  ResolveWorkspaceFileResult,
  WorkspaceFileEntry,
  WorkspaceFilesService,
  WorkspacePathPolicyService,
  WorkspaceService,
} from '../contracts/workspace-contracts';

export const DEFAULT_WORKSPACE_FILE_IGNORE_NAMES = [
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  '.vite',
  'coverage',
  '.turbo',
  '.cache',
] as const;

export interface WorkspaceFilesFileSystem {
  readdir(path: string, options: { withFileTypes: true }): Promise<Array<{
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
  }>>;
  stat(path: string): Promise<{ size: number; mtime: Date }>;
}

export function createWorkspaceFilesService(options: {
  workspaceService: Pick<WorkspaceService, 'getWorkspace'>;
  pathPolicy: Pick<WorkspacePathPolicyService, 'resolvePath'>;
  fileSystem: WorkspaceFilesFileSystem;
  ignoredNames?: readonly string[];
}): WorkspaceFilesService {
  const ignoredNames = new Set(options.ignoredNames ?? DEFAULT_WORKSPACE_FILE_IGNORE_NAMES);

  return {
    async listDirectory(request): Promise<ListWorkspaceDirectoryResult> {
      const workspace = options.workspaceService.getWorkspace({ workspace_id: request.workspace_id });
      if (workspace.status === 'not_found') return { status: 'workspace_not_found', workspace_id: request.workspace_id };
      const resolved = resolveRelativePath(workspace.workspace.root_path, request.directory_path, options.pathPolicy);
      if (resolved.status !== 'ok') return resolved;

      const entries = await options.fileSystem.readdir(resolved.absolutePath, { withFileTypes: true });
      const listed: WorkspaceFileEntry[] = [];
      for (const entry of entries) {
        if ((!entry.isDirectory() && !entry.isFile()) || ignoredNames.has(entry.name)) continue;
        const relativePath = joinRelative(resolved.relativePath, entry.name);
        const stats = await options.fileSystem.stat(path.join(resolved.absolutePath, entry.name));
        listed.push({
          name: entry.name,
          relative_path: relativePath,
          type: entry.isDirectory() ? 'directory' : 'file',
          depth: relativePath.split('/').filter(Boolean).length - 1,
          hidden: entry.name.startsWith('.'),
          ...(entry.isFile() ? { size_bytes: stats.size } : {}),
          modified_at: stats.mtime.toISOString(),
        });
      }

      return {
        status: 'ok',
        workspace_id: request.workspace_id,
        workspace_root: workspace.workspace.root_path,
        directory_path: resolved.relativePath,
        entries: listed.sort(compareEntries),
      };
    },

    resolveFile(request): ResolveWorkspaceFileResult {
      const workspace = options.workspaceService.getWorkspace({ workspace_id: request.workspace_id });
      if (workspace.status === 'not_found') return { status: 'workspace_not_found', workspace_id: request.workspace_id };
      const resolved = resolveRelativePath(workspace.workspace.root_path, request.file_path, options.pathPolicy);
      if (resolved.status !== 'ok') return resolved;
      return {
        status: 'ok',
        workspace_id: request.workspace_id,
        workspace_root: workspace.workspace.root_path,
        file_path: resolved.relativePath,
        absolute_path: resolved.absolutePath,
      };
    },
  };
}

function resolveRelativePath(
  workspaceRoot: string,
  inputPath: string,
  pathPolicy: Pick<WorkspacePathPolicyService, 'resolvePath'>,
): { status: 'ok'; absolutePath: string; relativePath: string } | { status: 'path_rejected'; reason: 'absolute_path' | 'outside_workspace' } {
  if (path.posix.isAbsolute(inputPath) || path.win32.isAbsolute(inputPath) || /^[a-zA-Z]:/.test(inputPath)) {
    return { status: 'path_rejected', reason: 'absolute_path' };
  }
  const normalized = path.posix.normalize(inputPath.replace(/\\/g, '/'));
  const relativePath = normalized === '.' ? '' : normalized.replace(/\/+$/, '');
  const resolved = pathPolicy.resolvePath({ workspace_root: workspaceRoot, target_path: relativePath });
  return resolved.status === 'resolved'
    ? {
        status: 'ok',
        absolutePath: resolved.absolute_path,
        relativePath: resolved.workspace_path === '.' ? '' : resolved.workspace_path,
      }
    : { status: 'path_rejected', reason: 'outside_workspace' };
}

function joinRelative(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

function compareEntries(left: WorkspaceFileEntry, right: WorkspaceFileEntry): number {
  if (left.type !== right.type) return left.type === 'directory' ? -1 : 1;
  return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
}
