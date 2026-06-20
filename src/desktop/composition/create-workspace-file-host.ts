// Adapts workspace file access to the local filesystem while enforcing the configured workspace root.
import fsp from 'node:fs/promises';
import path from 'node:path';
import type {
  WorkspaceDirectoryEntry,
  WorkspaceFileHost,
  WorkspacePath,
} from '../../workspace';
import { DesktopIpcError } from '../ipc/ipc-errors';

export function createWorkspaceFileHost(root: string): WorkspaceFileHost {
  const resolveWorkspacePath = (workspacePath: WorkspacePath): string => {
    const resolved = path.resolve(root, String(workspacePath));
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
      throw new DesktopIpcError('workspace_path_escape', 'Workspace path escaped the configured project root.');
    }
    return resolved;
  };

  return {
    async readTextFile(workspacePath) {
      return fsp.readFile(resolveWorkspacePath(workspacePath), 'utf8');
    },
    async writeTextFile(workspacePath, content) {
      const target = resolveWorkspacePath(workspacePath);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, content, 'utf8');
    },
    async deleteFile(workspacePath) {
      await fsp.rm(resolveWorkspacePath(workspacePath), { force: true });
    },
    async fileExists(workspacePath) {
      try {
        await fsp.access(resolveWorkspacePath(workspacePath));
        return true;
      } catch {
        return false;
      }
    },
    async listDirectory(workspacePath) {
      const absolute = resolveWorkspacePath(workspacePath);
      const entries = await fsp.readdir(absolute, { withFileTypes: true });
      return entries.map((entry): WorkspaceDirectoryEntry => ({
        name: entry.name,
        path: path.posix.join(String(workspacePath).replaceAll('\\', '/'), entry.name) as WorkspacePath,
        kind: entry.isDirectory() ? 'directory' : 'file',
      }));
    },
  };
}
