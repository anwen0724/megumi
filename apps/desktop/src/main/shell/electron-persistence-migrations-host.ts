// Resolves packaged migration assets from the Electron shell boundary.
import { app } from 'electron';
import path from 'node:path';

export interface ResolveDesktopPersistenceMigrationsFolderInput {
  isPackaged: boolean;
  resourcesPath: string;
  cwd: string;
}

export function resolveDesktopPersistenceMigrationsFolder(
  input: ResolveDesktopPersistenceMigrationsFolderInput,
): string {
  if (input.isPackaged) {
    return path.resolve(input.resourcesPath, 'persistence/migrations');
  }

  return path.resolve(input.cwd, 'packages/coding-agent/persistence/migrations');
}

export function resolveElectronPersistenceMigrationsFolder(): string {
  return resolveDesktopPersistenceMigrationsFolder({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    cwd: process.cwd(),
  });
}
