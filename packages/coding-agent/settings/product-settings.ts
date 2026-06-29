// Owns Coding Agent product settings resolution and projections used by product runtime composition.
import {
  mergePermissionSettingsScopes,
  type MergedPermissionSettings,
} from '@megumi/shared/permission';
import {
  mergeRawAppSettings,
  resolveAppSettings,
  type AppSettingsRaw,
  type AppSettingsResolved,
} from '@megumi/shared/settings';
import type { PermissionSettingsProvider } from '../permissions/permission-settings-provider';

export interface ProductSettingsStoragePort {
  readRawSettings(): AppSettingsRaw;
  writeRawSettings(next: AppSettingsRaw): void;
}

export interface ProductSettingsServiceOptions {
  storage: ProductSettingsStoragePort;
}

export interface MemorySettingsPort {
  isMemoryEnabled(): boolean;
}

export interface ProductSettingsPort {
  getRawSettings(): AppSettingsRaw;
  getResolvedSettings(): AppSettingsResolved;
  updateSettings(patch: AppSettingsRaw): AppSettingsResolved;
  getMemorySettings(): AppSettingsResolved['memory'];
  loadPermissionSettingsForProject(projectRoot?: string): Promise<MergedPermissionSettings>;
}

export class ProductSettingsService implements ProductSettingsPort, PermissionSettingsProvider {
  constructor(private readonly options: ProductSettingsServiceOptions) {}

  getRawSettings(): AppSettingsRaw {
    return this.options.storage.readRawSettings();
  }

  getResolvedSettings(): AppSettingsResolved {
    return resolveAppSettings(this.getRawSettings());
  }

  updateSettings(patch: AppSettingsRaw): AppSettingsResolved {
    const next = mergeRawAppSettings(this.getRawSettings(), patch);
    this.options.storage.writeRawSettings(next);
    return resolveAppSettings(next);
  }

  getMemorySettings(): AppSettingsResolved['memory'] {
    return this.getResolvedSettings().memory;
  }

  async loadForProject(projectRoot: string): Promise<MergedPermissionSettings> {
    return this.loadPermissionSettingsForProject(projectRoot);
  }

  async loadPermissionSettingsForProject(_projectRoot?: string): Promise<MergedPermissionSettings> {
    return mergePermissionSettingsScopes([
      {
        scope: 'user',
        settings: {
          permissions: this.getResolvedSettings().permissions,
        },
      },
    ]);
  }
}
