/*
 * Implements Workspace file-system seams with Node APIs; exported only through the node subpath.
 */
import { createHash } from 'node:crypto';
import {
  readFile,
  readdir,
  realpath,
  stat,
} from 'node:fs/promises';
import type { WorkspaceCatalogFileSystem } from './workspace-catalog';
import type { WorkspaceFilesFileSystem } from './workspace-files';

export type WorkspaceFileFingerprint =
  | { exists: false }
  | { exists: true; size_bytes: number; modified_at_ms: number; content_hash: string };

export type NodeWorkspaceFileSystem = WorkspaceCatalogFileSystem
  & WorkspaceFilesFileSystem
  & { fingerprint(target: string): Promise<WorkspaceFileFingerprint> };

export function createNodeWorkspaceFileSystem(): NodeWorkspaceFileSystem {
  return {
    stat,
    readdir,
    realpath,
    async fingerprint(target): Promise<WorkspaceFileFingerprint> {
      try {
        const metadata = await stat(target);
        if (!metadata.isFile()) return { exists: false };
        const contentHash = createHash('sha256').update(await readFile(target)).digest('hex');
        return {
          exists: true,
          size_bytes: metadata.size,
          modified_at_ms: metadata.mtimeMs,
          content_hash: contentHash,
        };
      } catch (error) {
        if (isMissingFileError(error)) return { exists: false };
        throw error;
      }
    },
  };
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'ENOENT';
}
