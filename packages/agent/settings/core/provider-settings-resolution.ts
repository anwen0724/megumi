/*
 * Resolves provider display status, selectable models, and runtime config from resolved Settings.
 * This file does not call model providers or import provider adapters.
 */
import type { SettingsResolved } from '../contracts/settings-contracts';
import type {
  AvailableModelOption,
  ProviderPublicStatus,
  ProviderSettingsRaw,
  ResolveModelContextSettingsResult,
  ResolveProviderRuntimeConfigRequest,
  ResolveProviderRuntimeConfigResult,
} from '../contracts/provider-settings-contracts';

type EnvMap = NodeJS.ProcessEnv | Record<string, string | undefined>;

export function listProviderStatuses(
  settings: SettingsResolved,
  env: EnvMap = {},
  rawProviders: Record<string, ProviderSettingsRaw> = {},
): ProviderPublicStatus[] {
  return Object.entries(settings.providers).map(([providerId, provider]) => {
    const settingsApiKeyActive = Boolean(provider.api_key?.trim());
    const envOverrideActive = Boolean(provider.api_key_env && env[provider.api_key_env]?.trim());
    const apiKey = resolveApiKey(provider.api_key, provider.api_key_env, env);

    return {
      provider_id: providerId,
      display_name: provider.display_name,
      enabled: provider.enabled,
      api: provider.api,
      ...(provider.base_url ? { base_url: provider.base_url } : {}),
      models: Object.keys(provider.models),
      model_settings: provider.models,
      model_capabilities: Object.fromEntries(
        Object.entries(provider.models).map(([modelId, model]) => [modelId, model.capabilities]),
      ),
      model_capability_overrides: Object.fromEntries(
        Object.keys(provider.models).map((modelId) => [
          modelId,
          rawProviders[providerId]?.models?.[modelId]?.capabilities ?? {},
        ]),
      ),
      has_api_key: settingsApiKeyActive || envOverrideActive,
      ...(apiKey ? { api_key: apiKey } : {}),
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

    return Object.keys(provider.models).map((modelId) => ({
      provider_id: providerId,
      model_id: modelId,
      display_name: provider.models[modelId]!.display_name,
      capabilities: provider.models[modelId]!.capabilities,
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

  if (!provider.models[request.model_id]) {
    return failed('provider_model_unknown', 'Provider model is not configured.', request);
  }

  if (!provider.base_url) {
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
      api: provider.api,
      ...(provider.base_url ? { base_url: provider.base_url } : {}),
      model_id: request.model_id,
      display_name: provider.models[request.model_id]!.display_name,
      context_window_tokens: provider.models[request.model_id]!.context_window_tokens,
      max_output_tokens: provider.models[request.model_id]!.max_output_tokens,
      capabilities: provider.models[request.model_id]!.capabilities,
      api_key: apiKey,
    },
  };
}

export function resolveModelContextSettings(
  settings: SettingsResolved,
  request: ResolveProviderRuntimeConfigRequest,
): ResolveModelContextSettingsResult {
  const provider = settings.providers[request.provider_id];
  const model = provider?.models[request.model_id];
  if (!provider || !model) {
    return {
      status: 'failed',
      failure: {
        code: 'provider_model_unknown',
        message: 'Provider model is not configured.',
        details: { provider_id: request.provider_id, model_id: request.model_id },
      },
    };
  }
  return {
    status: 'ok' as const,
    context: {
      context_window_tokens: model.context_window_tokens,
      compaction_threshold_ratio: settings.context.compaction_threshold_ratio,
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
