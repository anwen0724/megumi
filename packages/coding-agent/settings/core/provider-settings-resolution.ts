/*
 * Resolves provider display status, selectable models, and runtime config from resolved Settings.
 * This file does not call model providers or import provider adapters.
 */
import type { SettingsResolved } from '../contracts/settings-contracts';
import type {
  AvailableModelOption,
  ProviderPublicStatus,
  ResolveProviderRuntimeConfigRequest,
  ResolveProviderRuntimeConfigResult,
} from '../contracts/provider-settings-contracts';

type EnvMap = NodeJS.ProcessEnv | Record<string, string | undefined>;

export function listProviderStatuses(
  settings: SettingsResolved,
  env: EnvMap = {},
): ProviderPublicStatus[] {
  return Object.entries(settings.providers).map(([providerId, provider]) => {
    const settingsApiKeyActive = Boolean(provider.api_key?.trim());
    const envOverrideActive = Boolean(provider.api_key_env && env[provider.api_key_env]?.trim());

    return {
      provider_id: providerId,
      display_name: provider.display_name,
      enabled: provider.enabled,
      protocol: provider.protocol,
      ...(provider.base_url ? { base_url: provider.base_url } : {}),
      models: provider.models,
      has_api_key: settingsApiKeyActive || envOverrideActive,
      credential_source: settingsApiKeyActive
        ? 'settings'
        : envOverrideActive
          ? 'environment'
          : 'missing',
      env_override_active: envOverrideActive,
      ...(provider.api_key_env ? { api_key_env: provider.api_key_env } : {}),
    };
  });
}

export function listAvailableModels(settings: SettingsResolved): AvailableModelOption[] {
  return Object.entries(settings.providers).flatMap(([providerId, provider]) => {
    if (!provider.enabled) {
      return [];
    }

    return provider.models.map((modelId) => ({
      provider_id: providerId,
      model_id: modelId,
      display_name: modelId,
    }));
  });
}

export function resolveProviderRuntimeConfig(
  settings: SettingsResolved,
  request: ResolveProviderRuntimeConfigRequest,
  env: EnvMap = {},
): ResolveProviderRuntimeConfigResult {
  const provider = settings.providers[request.provider_id];
  if (!provider) {
    return failed('provider_unknown', 'Provider settings were not found.', request);
  }

  if (!provider.enabled) {
    return failed('provider_disabled', 'Provider is disabled.', request);
  }

  if (!provider.models.includes(request.model_id)) {
    return failed('provider_model_unknown', 'Provider model is not configured.', request);
  }

  if (provider.protocol === 'openai-compatible' && !provider.base_url) {
    return failed('provider_config_invalid', 'Provider base URL is required.', request);
  }

  const apiKey = resolveApiKey(provider.api_key, provider.api_key_env, env);
  if (!apiKey) {
    return failed('provider_missing_api_key', 'Provider API key is missing.', request);
  }

  return {
    status: 'ok',
    config: {
      provider_id: request.provider_id,
      protocol: provider.protocol,
      ...(provider.base_url ? { base_url: provider.base_url } : {}),
      model_id: request.model_id,
      api_key: apiKey,
    },
  };
}

function resolveApiKey(
  settingsApiKey: string | undefined,
  apiKeyEnv: string | undefined,
  env: EnvMap,
): string | undefined {
  const direct = settingsApiKey?.trim();
  if (direct) {
    return direct;
  }

  const fromEnv = apiKeyEnv ? env[apiKeyEnv]?.trim() : undefined;
  return fromEnv || undefined;
}

function failed(
  code: string,
  message: string,
  request: ResolveProviderRuntimeConfigRequest,
): ResolveProviderRuntimeConfigResult {
  return {
    status: 'failed',
    failure: {
      code,
      message,
      details: {
        provider_id: request.provider_id,
        model_id: request.model_id,
      },
    },
  };
}
