// Controller for product settings operations exposed to UI shells.
import type { AppSettingsRaw, AppSettingsResolved } from '@megumi/shared/settings';
import type { SettingsData } from '@megumi/shared/ipc';

export interface SettingsControllerProductSettingsPort {
  getResolvedSettings(): AppSettingsResolved;
  updateSettings(patch: AppSettingsRaw): AppSettingsResolved;
}

export interface SettingsController {
  get(): SettingsData;
  update(patch: AppSettingsRaw): SettingsData;
}

export function createSettingsController(
  settingsService: SettingsControllerProductSettingsPort,
): SettingsController {
  return {
    get: () => ({ settings: settingsService.getResolvedSettings() }),
    update: (patch) => ({ settings: settingsService.updateSettings(patch) }),
  };
}
