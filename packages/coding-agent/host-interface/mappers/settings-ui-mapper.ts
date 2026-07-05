/*
 * Maps Settings module facts into host-facing settings UI DTOs.
 */
import type {
  SettingsRaw,
  SettingsResolved,
  SettingsThemeName,
} from '../../settings';
import type {
  ProviderPublicStatusUiDto,
  SettingsUiRaw,
  SettingsUiResolved,
} from '../contracts/settings-ui-contracts';

export function toSettingsRawPatch(patch: SettingsUiRaw): SettingsRaw {
  return {
    ...(patch.language ? { language: patch.language } : {}),
    ...(patch.theme ? { theme: patch.theme as SettingsThemeName } : {}),
    ...(patch.setup ? {
      setup: {
        ...(patch.setup.completed !== undefined ? { completed_at: patch.setup.completedAt, completed: patch.setup.completed } : {}),
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
          ...(provider.protocol ? { protocol: provider.protocol } : {}),
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

export function toSettingsUiResolved(settings: SettingsResolved): SettingsUiResolved {
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
        protocol: provider.protocol,
        displayName: provider.display_name,
        ...(provider.base_url ? { baseUrl: provider.base_url } : {}),
        models: provider.models,
        ...(provider.api_key_env ? { apiKeyEnv: provider.api_key_env } : {}),
      },
    ])),
  };
}

export function toProviderPublicStatusUiDto(provider: {
  provider_id: string;
  display_name: string;
  enabled: boolean;
  protocol: ProviderPublicStatusUiDto['protocol'];
  base_url?: string;
  models: string[];
  has_api_key: boolean;
  credential_source: ProviderPublicStatusUiDto['credentialSource'];
  env_override_active: boolean;
  api_key_env?: string;
  api_key_env_customized?: boolean;
}): ProviderPublicStatusUiDto {
  return {
    providerId: provider.provider_id,
    displayName: provider.display_name,
    enabled: provider.enabled,
    protocol: provider.protocol,
    ...(provider.base_url ? { baseUrl: provider.base_url } : {}),
    modelIds: provider.models,
    hasApiKey: provider.has_api_key,
    credentialSource: provider.credential_source,
    envOverrideActive: provider.env_override_active,
    ...(provider.api_key_env ? { apiKeyEnv: provider.api_key_env } : {}),
    ...(provider.api_key_env_customized !== undefined ? { apiKeyEnvCustomized: provider.api_key_env_customized } : {}),
  };
}
