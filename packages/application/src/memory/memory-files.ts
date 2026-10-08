/* Binds artifact inspection to the application-owned memory root. */
import { lstatSync, readdirSync } from 'node:fs';

export interface MemoryFiles {
  hasArtifacts(): boolean;
}

export function createMemoryFiles(rootPath: string): MemoryFiles {
  return {
    hasArtifacts() {
      try {
        // Do not follow a root replaced with a link into another directory.
        const root = lstatSync(rootPath);
        if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('Invalid memory directory.');
        return readdirSync(rootPath).length > 0;
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
        throw error;
      }
    },
  };
}
