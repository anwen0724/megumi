/*
 * Provides canonical Workspace directory reads and safe file-reference resolution.
 */
import path from 'node:path';
import type { WorkspaceCatalog } from './workspace-catalog';
import type { WorkspacePathPolicy } from './workspace-path-policy';

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

export interface WorkspaceFileEntry {
  name: string;
  relative_path: string;
  type: 'file' | 'directory';
  depth: number;
  hidden: boolean;
  size_bytes?: number;
  modified_at: string;
}
export interface ListWorkspaceDirectoryRequest { workspace_id: string; directory_path: string }
export type ListWorkspaceDirectoryResult =
  | {
      status: 'ok';
      workspace_id: string;
      workspace_root: string;
      directory_path: string;
      entries: WorkspaceFileEntry[];
    }
  | { status: 'workspace_not_found'; workspace_id: string }
  | { status: 'path_rejected'; reason: 'absolute_path' | 'outside_workspace' };
export interface ResolveWorkspaceFileRequest { workspace_id: string; file_path: string }
export type ResolveWorkspaceFileResult =
  | {
      status: 'ok';
      workspace_id: string;
      workspace_root: string;
      file_path: string;
      absolute_path: string;
    }
  | { status: 'workspace_not_found'; workspace_id: string }
  | { status: 'path_rejected'; reason: 'absolute_path' | 'outside_workspace' };

export interface WorkspaceFiles {
  listDirectory(request: ListWorkspaceDirectoryRequest): Promise<ListWorkspaceDirectoryResult>;
  resolveFile(request: ResolveWorkspaceFileRequest): Promise<ResolveWorkspaceFileResult>;
}

export interface WorkspaceFilesFileSystem {
  realpath(path: string): Promise<string>;
  readdir(path: string, options: { withFileTypes: true }): Promise<Array<{
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
  }>>;
  stat(path: string): Promise<{ size: number; mtime: Date }>;
}

export interface CreateWorkspaceFilesRequest {
  catalog: Pick<WorkspaceCatalog, 'getWorkspace'>;
  path_policy: WorkspacePathPolicy;
  file_system: WorkspaceFilesFileSystem;
  ignored_names?: readonly string[];
  platform?: NodeJS.Platform;
}

export function createWorkspaceFiles(options: CreateWorkspaceFilesRequest): WorkspaceFiles {
  const ignoredNames = new Set(options.ignored_names ?? DEFAULT_WORKSPACE_FILE_IGNORE_NAMES);
  return {
    async listDirectory(request) {
      const workspace = options.catalog.getWorkspace({ workspace_id: request.workspace_id });
      if (workspace.status === 'not_found') {
        return { status: 'workspace_not_found', workspace_id: request.workspace_id };
      }
      const resolved = await resolveRelativePath({
        workspaceRoot: workspace.workspace.root_path,
        inputPath: request.directory_path,
        pathPolicy: options.path_policy,
        fileSystem: options.file_system,
        platform: options.platform,
      });
      if (resolved.status !== 'ok') return resolved;

      const entries = await options.file_system.readdir(resolved.absolutePath, { withFileTypes: true });
      const listed: WorkspaceFileEntry[] = [];
      for (const entry of entries) {
        if ((!entry.isDirectory() && !entry.isFile()) || ignoredNames.has(entry.name)) continue;
        const relativePath = joinRelative(resolved.relativePath, entry.name);
        const stats = await options.file_system.stat(path.join(resolved.absolutePath, entry.name));
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

    async resolveFile(request) {
      const workspace = options.catalog.getWorkspace({ workspace_id: request.workspace_id });
      if (workspace.status === 'not_found') {
        return { status: 'workspace_not_found', workspace_id: request.workspace_id };
      }
      const resolved = await resolveRelativePath({
        workspaceRoot: workspace.workspace.root_path,
        inputPath: request.file_path,
        pathPolicy: options.path_policy,
        fileSystem: options.file_system,
        platform: options.platform,
      });
      return resolved.status === 'ok'
        ? {
            status: 'ok',
            workspace_id: request.workspace_id,
            workspace_root: workspace.workspace.root_path,
            file_path: resolved.relativePath,
            absolute_path: resolved.absolutePath,
          }
        : resolved;
    },
  };
}

async function resolveRelativePath(input: {
  workspaceRoot: string;
  inputPath: string;
  pathPolicy: WorkspacePathPolicy;
  fileSystem: WorkspaceFilesFileSystem;
  platform?: NodeJS.Platform;
}): Promise<
  | { status: 'ok'; absolutePath: string; relativePath: string }
  | { status: 'path_rejected'; reason: 'absolute_path' | 'outside_workspace' }
> {
  if (path.posix.isAbsolute(input.inputPath)
    || path.win32.isAbsolute(input.inputPath)
    || /^[a-zA-Z]:/.test(input.inputPath)) {
    return { status: 'path_rejected', reason: 'absolute_path' };
  }
  const normalized = path.posix.normalize(input.inputPath.replace(/\\/g, '/'));
  const relativePath = normalized === '.' ? '' : normalized.replace(/\/+$/, '');
  let resolved;
  try {
    resolved = await input.pathPolicy.resolveCanonicalPath({
      workspace_root: input.workspaceRoot,
      target_path: relativePath,
      file_system: input.fileSystem,
      ...(input.platform ? { platform: input.platform } : {}),
    });
  } catch {
    return { status: 'path_rejected', reason: 'outside_workspace' };
  }
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
