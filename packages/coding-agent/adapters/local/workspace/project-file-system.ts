// Provides the default node:fs-backed workspace file system for product
// services. File system access is a Host privilege, so it lives in the local
// adapter layer rather than the workspace product service.
import { stat as nodeStat } from 'node:fs/promises';

export interface LocalWorkspaceServiceFileSystem {
  stat(path: string): Promise<{ isDirectory(): boolean }>;
  exists(path: string): Promise<boolean>;
}

export function createLocalProjectFileSystem(): LocalWorkspaceServiceFileSystem {
  return {
    stat: (path) => nodeStat(path),
    exists: async (path) => {
      try {
        await nodeStat(path);
        return true;
      } catch {
        return false;
      }
    },
  };
}
