// Controller for product settings operations exposed to UI shells.
import type { AppSettingsRaw } from '@megumi/shared/settings';
import type { SettingsData } from '@megumi/shared/ipc';
import type { ProductSettingsPort } from '../../settings';

export interface SettingsController {
  get(): SettingsData;
  update(patch: AppSettingsRaw): SettingsData;
}

export function createSettingsController(
  settingsService: ProductSettingsPort,
): SettingsController {
  return {
    get: () => ({ settings: settingsService.getResolvedSettings() }),
    update: (patch) => ({ settings: settingsService.updateSettings(patch) }),
  };
}
