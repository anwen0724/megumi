// Owns Coding Agent product settings resolution and projections used by host interface composition.
import {
  mergePermissionSettingsScopes,
  type MergedPermissionSettings,
} from '@megumi/shared/permission';
import {
  mergeRawAppSettings,
  resolveAppSettings,
} from '../core/settings-resolution';
import type {
  AppSettingsRaw,
  AppSettingsResolved,
} from '../contracts/settings-contracts';
import type { PermissionSettingsProvider } from '../../permissions/permission-settings-provider';

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

export function resolveMemoryEnabled(provider?: MemorySettingsPort): boolean {
  if (!provider) {
    return false;
  }
  try {
    return provider.isMemoryEnabled();
  } catch {
    return false;
  }
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
