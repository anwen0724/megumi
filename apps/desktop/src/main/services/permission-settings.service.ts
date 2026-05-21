import path from 'node:path';
import {
  PermissionSettingsSchema,
  mergePermissionSettingsScopes,
  type MergedPermissionSettings,
  type PermissionSettings,
  type ScopedPermissionSettings,
} from '@megumi/shared/permission-settings-contracts';

export interface PermissionSettingsFileSystem {
  pathExists(filePath: string): Promise<boolean>;
  readJson(filePath: string): Promise<unknown>;
}

export interface PermissionSettingsServiceOptions {
  userConfigPath: string;
  fileSystem: PermissionSettingsFileSystem;
}

export interface PermissionSettingsService {
  loadForProject(projectRoot: string): Promise<MergedPermissionSettings>;
}

export function createPermissionSettingsService(
  options: PermissionSettingsServiceOptions,
): PermissionSettingsService {
  return {
    async loadForProject(projectRoot) {
      const scoped: ScopedPermissionSettings[] = [];

      const userSettings = await readSettingsIfPresent(options.fileSystem, options.userConfigPath);
      if (userSettings) {
        scoped.push({ scope: 'user', settings: userSettings });
      }

      const projectSettings = await readSettingsIfPresent(
        options.fileSystem,
        path.join(projectRoot, '.megumi', 'settings.json'),
      );
      if (projectSettings) {
        scoped.push({ scope: 'project', settings: projectSettings });
      }

      const localSettings = await readSettingsIfPresent(
        options.fileSystem,
        path.join(projectRoot, '.megumi', 'settings.local.json'),
      );
      if (localSettings) {
        scoped.push({ scope: 'local', settings: localSettings });
      }

      return mergePermissionSettingsScopes(scoped);
    },
  };
}

async function readSettingsIfPresent(
  fileSystem: PermissionSettingsFileSystem,
  filePath: string,
): Promise<PermissionSettings | undefined> {
  if (!(await fileSystem.pathExists(filePath))) {
    return undefined;
  }

  return PermissionSettingsSchema.parse(await fileSystem.readJson(filePath));
}
