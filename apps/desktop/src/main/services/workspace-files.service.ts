import fs from 'fs-extra';
import path from 'node:path';
import {
  PathSandboxViolationError,
  resolveSafePath,
} from '@megumi/security/sandbox-policy';
import type {
  WorkspaceDirectoryEntry,
  WorkspaceFilesListData,
  WorkspaceFilesListPayload,
} from '@megumi/shared/workspace-file-contracts';

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

export interface WorkspaceFilesService {
  listDirectory(input: WorkspaceFilesListPayload): Promise<WorkspaceFilesListData>;
}

export interface CreateWorkspaceFilesServiceOptions {
  fileSystem?: WorkspaceFilesFileSystem;
  ignoredNames?: readonly string[];
  allowedWorkspaceRoots?: readonly string[];
  isWorkspaceRootAllowed?: (root: string) => boolean;
}

export function createWorkspaceFilesService(
  options: CreateWorkspaceFilesServiceOptions = {},
): WorkspaceFilesService {
  const fileSystem = options.fileSystem ?? fs;
  const ignoredNames = new Set(options.ignoredNames ?? DEFAULT_WORKSPACE_FILE_IGNORE_NAMES);
  const allowedWorkspaceRootKeys = options.allowedWorkspaceRoots
    ? new Set(options.allowedWorkspaceRoots.map(toWorkspaceRootKey))
    : undefined;

  return {
    async listDirectory(input) {
      const workspaceRoot = normalizeWorkspaceRoot(input.workspaceRoot);
      assertWorkspaceRootAllowed({
        workspaceRoot,
        allowedWorkspaceRootKeys,
        isWorkspaceRootAllowed: options.isWorkspaceRootAllowed,
      });

      const directoryPath = normalizeDirectoryPath(input.directoryPath);
      const resolvedDirectory = resolveSafePath(workspaceRoot, directoryPath);
      const entries = await fileSystem.readdir(resolvedDirectory, { withFileTypes: true });
      const listedEntries: WorkspaceDirectoryEntry[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isFile()) {
          continue;
        }

        if (ignoredNames.has(entry.name)) {
          continue;
        }

        const relativePath = toRelativePath(directoryPath, entry.name);
        const stats = await fileSystem.stat(path.join(resolvedDirectory, entry.name));
        const kind = entry.isDirectory() ? 'directory' : 'file';

        listedEntries.push({
          name: entry.name,
          relativePath,
          kind,
          depth: depthFor(relativePath),
          hidden: entry.name.startsWith('.'),
          ignored: false,
          ...(kind === 'file' ? { sizeBytes: stats.size } : {}),
          mtime: stats.mtime.toISOString(),
        });
      }

      return {
        workspaceRoot: input.workspaceRoot,
        directoryPath,
        entries: listedEntries.sort(compareEntries),
      };
    },
  };
}

function normalizeDirectoryPath(directoryPath: string): string {
  if (isAbsoluteOrDriveQualifiedPath(directoryPath)) {
    throw new PathSandboxViolationError('', directoryPath);
  }

  const normalized = path.posix.normalize(directoryPath.replace(/\\/g, '/'));

  if (normalized === '.') {
    return '';
  }

  return normalized.replace(/\/+$/, '');
}

function toRelativePath(parentPath: string, name: string): string {
  return parentPath ? `${parentPath}/${name}` : name;
}

function depthFor(relativePath: string): number {
  return relativePath.split('/').filter(Boolean).length - 1;
}

function compareEntries(left: WorkspaceDirectoryEntry, right: WorkspaceDirectoryEntry): number {
  if (left.kind !== right.kind) {
    return left.kind === 'directory' ? -1 : 1;
  }

  return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
}

function normalizeWorkspaceRoot(workspaceRoot: string): string {
  return path.resolve(workspaceRoot);
}

function toWorkspaceRootKey(workspaceRoot: string): string {
  const normalized = normalizeWorkspaceRoot(workspaceRoot);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function assertWorkspaceRootAllowed(input: {
  workspaceRoot: string;
  allowedWorkspaceRootKeys?: ReadonlySet<string>;
  isWorkspaceRootAllowed?: (root: string) => boolean;
}): void {
  if (!input.allowedWorkspaceRootKeys && !input.isWorkspaceRootAllowed) {
    return;
  }

  if (
    input.allowedWorkspaceRootKeys &&
    !input.allowedWorkspaceRootKeys.has(toWorkspaceRootKey(input.workspaceRoot))
  ) {
    throw new PathSandboxViolationError(input.workspaceRoot, '');
  }

  if (input.isWorkspaceRootAllowed && !input.isWorkspaceRootAllowed(input.workspaceRoot)) {
    throw new PathSandboxViolationError(input.workspaceRoot, '');
  }
}

function isAbsoluteOrDriveQualifiedPath(directoryPath: string): boolean {
  return (
    path.posix.isAbsolute(directoryPath) ||
    path.win32.isAbsolute(directoryPath) ||
    /^[a-zA-Z]:/.test(directoryPath)
  );
}
