/* Node filesystem adapter for Workspace directory browsing. */
import { readdir, stat } from 'node:fs/promises';
import type { WorkspaceFilesFileSystem } from '../../../workspace';

export function createLocalWorkspaceFilesFileSystem(): WorkspaceFilesFileSystem {
  return { readdir, stat };
}
