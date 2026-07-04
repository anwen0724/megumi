// Controller for product settings operations exposed to UI shells.
import type {
  SettingsRaw,
  SettingsResolved,
  SettingsService,
} from '../../settings';
import type {
  AppSettingsRaw,
  AppSettingsResolved,
} from './app-settings-contracts';
import type { SettingsData } from './settings-ipc-contracts';

export interface SettingsController {
  get(): SettingsData;
  update(patch: AppSettingsRaw): SettingsData;
}

export function createSettingsController(
  settingsService: Pick<SettingsService, 'getResolvedSettings' | 'updateSettings'>,
): SettingsController {
  return {
    get: () => ({ settings: toAppSettingsResolved(unwrap(settingsService.getResolvedSettings())) }),
    update: (patch) => {
      const result = settingsService.updateSettings({ patch: toSettingsRawPatch(patch) });
      if (result.status === 'failed') {
        throw new Error(result.failure.message);
      }
      return { settings: toAppSettingsResolved(result.settings) };
    },
  };
}

function unwrap(result: ReturnType<SettingsService['getResolvedSettings']>) {
  if (result.status === 'failed') {
    throw new Error(result.failure.message);
  }
  return result.settings;
}

function toSettingsRawPatch(patch: AppSettingsRaw): SettingsRaw {
  return {
    ...(patch.language ? { language: patch.language } : {}),
    ...(patch.theme ? { theme: patch.theme } : {}),
    ...(patch.setup ? {
      setup: {
        ...(patch.setup.completed !== undefined ? { completed: patch.setup.completed } : {}),
        ...(patch.setup.completedAt ? { completed_at: patch.setup.completedAt } : {}),
      },
    } : {}),
    ...(patch.memory ? { memory: patch.memory } : {}),
    ...(patch.compaction ? {
      compaction: {
        ...(patch.compaction.enabled !== undefined ? { enabled: patch.compaction.enabled } : {}),
        ...(patch.compaction.reserveTokens !== undefined ? { reserve_tokens: patch.compaction.reserveTokens } : {}),
        ...(patch.compaction.keepRecentTokens !== undefined ? { keep_recent_tokens: patch.compaction.keepRecentTokens } : {}),
      },
    } : {}),
    ...(patch.providers ? {
      providers: Object.fromEntries(Object.entries(patch.providers).map(([providerId, provider]) => [
        providerId,
        {
          ...(provider.enabled !== undefined ? { enabled: provider.enabled } : {}),
          ...(provider.kind ? { kind: provider.kind } : {}),
          ...(provider.displayName ? { display_name: provider.displayName } : {}),
          ...(provider.baseUrl ? { base_url: provider.baseUrl } : {}),
          ...(provider.models ? { models: provider.models } : {}),
          ...(provider.apiKey !== undefined ? { api_key: provider.apiKey } : {}),
          ...(provider.apiKeyEnv !== undefined ? { api_key_env: provider.apiKeyEnv } : {}),
        },
      ])),
    } : {}),
  };
}

function toAppSettingsResolved(settings: SettingsResolved): AppSettingsResolved {
  return {
    language: settings.language,
    theme: settings.theme,
    setup: {
      completed: settings.setup.completed,
      ...(settings.setup.completed_at ? { completedAt: settings.setup.completed_at } : {}),
    },
    memory: settings.memory,
    compaction: {
      enabled: settings.compaction.enabled,
      reserveTokens: settings.compaction.reserve_tokens,
      keepRecentTokens: settings.compaction.keep_recent_tokens,
    },
    providers: Object.fromEntries(Object.entries(settings.providers).map(([providerId, provider]) => [
      providerId,
      {
        enabled: provider.enabled,
        kind: provider.kind,
        displayName: provider.display_name,
        ...(provider.base_url ? { baseUrl: provider.base_url } : {}),
        models: provider.models,
        ...(provider.api_key_env ? { apiKeyEnv: provider.api_key_env } : {}),
      },
    ])),
  };
}
