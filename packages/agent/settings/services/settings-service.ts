/*
 * Public Settings Service that reads sparse raw settings, resolves product settings,
 * and exposes provider runtime and permission settings capabilities to callers.
 */
import type { RuntimeError } from '../../events';
import { listBuiltinProviderCatalog } from '../core/ai-model-catalog';
import {
  mergeRawSettings,
  resolveSettings,
} from '../core/settings-resolution';
import {
  listAvailableModels as listAvailableModelsFromSettings,
  listProviderStatuses,
  resolveProviderRuntimeConfig as resolveProviderRuntimeConfigFromSettings,
  resolveModelContextSettings as resolveModelContextSettingsFromSettings,
} from '../core/provider-settings-resolution';
import {
  addPermissionRulesToRawSettings,
  changePermissionRulesInRawSettings,
  resolvePermissionSettingsFromResolvedSettings,
} from '../core/permission-settings-resolution';
import {
  SettingsRawSchema,
  CompleteSetupRequestSchema,
  UpdateSettingsRequestSchema,
  type CompleteSetupRequest,
  type CompleteSetupResult,
  type GetRawSettingsResult,
  type GetResolvedSettingsResult,
  type SettingsError,
  type SettingsFileStore,
  type SettingsRaw,
  type UpdateSettingsRequest,
  type UpdateSettingsResult,
} from '../contracts/settings-contracts';
import {
  ClearProviderApiKeyRequestSchema,
  DeleteProviderSettingsRequestSchema,
  GetProviderSettingsRequestSchema,
  SetProviderApiKeyRequestSchema,
  UpdateProviderSettingsRequestSchema,
  type ClearProviderApiKeyRequest,
  type ClearProviderApiKeyResult,
  type DeleteProviderSettingsRequest,
  type DeleteProviderSettingsResult,
  type GetProviderSettingsRequest,
  type GetProviderSettingsResult,
  type ListAvailableModelsResult,
  type ListProviderCatalogResult,
  type ListProviderSettingsResult,
  type ProviderSettingsRaw,
  type ResolveProviderRuntimeConfigRequest,
  type ResolveProviderRuntimeConfigResult,
  type ResolveModelContextSettingsResult,
  type ProviderSettingsResolved,
  type SetProviderApiKeyRequest,
  type SetProviderApiKeyResult,
  type UpdateProviderSettingsRequest,
  type UpdateProviderSettingsResult,
} from '../contracts/provider-settings-contracts';
import {
  AddPermissionRulesRequestSchema,
  ChangePermissionRulesRequestSchema,
  ResolvePermissionSettingsRequestSchema,
  type AddPermissionRulesRequest,
  type AddPermissionRulesResult,
  type ChangePermissionRulesRequest,
  type ChangePermissionRulesResult,
  type ResolvePermissionSettingsRequest,
  type ResolvePermissionSettingsResult,
} from '../contracts/permission-settings-contracts';
import {
  DEFAULT_WEB_SEARCH_API_KEY_ENV,
  type GetWebSearchSettingsResult,
  type ResolveWebSearchRuntimeConfigResult,
  type WebSearchProvider,
} from '../contracts/web-search-settings-contracts';

type EnvMap = NodeJS.ProcessEnv | Record<string, string | undefined>;

export interface SettingsServiceOptions {
  file_store: SettingsFileStore;
  env?: EnvMap;
  now?: () => string;
}

export interface SettingsService {
  getRawSettings(): GetRawSettingsResult;
  getResolvedSettings(): GetResolvedSettingsResult;
  updateSettings(request: UpdateSettingsRequest): UpdateSettingsResult;
  completeSetup(request: CompleteSetupRequest): CompleteSetupResult;

  listProviderSettings(): ListProviderSettingsResult;
  listProviderCatalog(): ListProviderCatalogResult;
  listAvailableModels(): ListAvailableModelsResult;
  getProviderSettings(request: GetProviderSettingsRequest): GetProviderSettingsResult;
  updateProviderSettings(request: UpdateProviderSettingsRequest): UpdateProviderSettingsResult;
  deleteProviderSettings(request: DeleteProviderSettingsRequest): DeleteProviderSettingsResult;
  setProviderApiKey(request: SetProviderApiKeyRequest): SetProviderApiKeyResult;
  clearProviderApiKey(request: ClearProviderApiKeyRequest): ClearProviderApiKeyResult;
  resolveProviderRuntimeConfig(
    request: ResolveProviderRuntimeConfigRequest,
  ): ResolveProviderRuntimeConfigResult;
  resolveModelContextSettings(
    request: ResolveProviderRuntimeConfigRequest,
  ): ResolveModelContextSettingsResult;

  getWebSearchSettings(): GetWebSearchSettingsResult;
  resolveWebSearchRuntimeConfig(): ResolveWebSearchRuntimeConfigResult;

  resolvePermissionSettings(request: ResolvePermissionSettingsRequest): ResolvePermissionSettingsResult;
  addPermissionRules(request: AddPermissionRulesRequest): AddPermissionRulesResult;
  changePermissionRules(request: ChangePermissionRulesRequest): ChangePermissionRulesResult;
}

export function createSettingsService(options: SettingsServiceOptions): SettingsService {
  return new DefaultSettingsService(options);
}

export class ProviderRuntimeResolutionError extends Error {
  constructor(readonly payload: RuntimeError) {
    super(payload.message);
    this.name = 'ProviderRuntimeResolutionError';
  }
}

class DefaultSettingsService implements SettingsService {
  private readonly env: EnvMap;

  constructor(private readonly options: SettingsServiceOptions) {
    this.env = options.env ?? {};
  }

  getRawSettings(): GetRawSettingsResult {
    const raw = this.readRawSettings();
    if (isSettingsFailure(raw)) return raw;
    return {
      status: 'ok',
      settings: raw,
    };
  }

  getResolvedSettings(): GetResolvedSettingsResult {
    const settings = this.readResolvedSettings();
    if (isSettingsFailure(settings)) return settings;
    return {
      status: 'ok',
      settings,
    };
  }

  updateSettings(request: UpdateSettingsRequest): UpdateSettingsResult {
    const parsed = UpdateSettingsRequestSchema.safeParse(request);
    if (!parsed.success) {
      return failed('settings_patch_invalid', 'Settings patch is invalid.', { issues: parsed.error.issues });
    }

    const raw = this.readRawSettings();
    if (isSettingsFailure(raw)) return raw;

    const merged = mergeRawSettings(raw, parsed.data.patch);
    const next = materializeSettingsForWrite(merged);
    this.options.file_store.writeRawSettings(next);
    return {
      status: 'updated',
      settings: resolveSettings(next),
    };
  }

  completeSetup(request: CompleteSetupRequest): CompleteSetupResult {
    const parsed = CompleteSetupRequestSchema.safeParse(request);
    if (!parsed.success) {
      return failed('setup_completion_invalid', 'Setup completion request is invalid.', {
        issues: parsed.error.issues,
      });
    }

    const raw = this.readRawSettings();
    if (isSettingsFailure(raw)) return raw;

    const providerPatch = parsed.data.provider
      ? {
          [parsed.data.provider.provider_id]: {
            ...(parsed.data.provider.enabled !== undefined ? { enabled: parsed.data.provider.enabled } : {}),
            ...(parsed.data.provider.api ? { api: parsed.data.provider.api } : {}),
            ...(parsed.data.provider.display_name ? { display_name: parsed.data.provider.display_name } : {}),
            ...(parsed.data.provider.base_url ? { base_url: parsed.data.provider.base_url } : {}),
            ...(parsed.data.provider.models
              ? { models: Object.fromEntries(parsed.data.provider.models.map((modelId) => [modelId, {}])) }
              : {}),
            ...(parsed.data.provider.api_key ? { api_key: parsed.data.provider.api_key } : {}),
            ...(parsed.data.provider.api_key_env !== undefined ? { api_key_env: parsed.data.provider.api_key_env } : {}),
          },
        }
      : undefined;

    const next = materializeSettingsForWrite(mergeRawSettings(raw, {
      ...(parsed.data.language ? { language: parsed.data.language } : {}),
      ...(parsed.data.theme ? { theme: parsed.data.theme } : {}),
      setup: {
        completed: true,
        completed_at: this.now(),
      },
      ...(providerPatch ? { providers: providerPatch } : {}),
    }));
    this.options.file_store.writeRawSettings(next);
    return {
      status: 'completed',
      settings: resolveSettings(next),
    };
  }

  listProviderSettings(): ListProviderSettingsResult {
    const settings = this.readResolvedSettings();
    if (isSettingsFailure(settings)) return settings;
    const raw = this.readRawSettings();
    if (isSettingsFailure(raw)) return raw;
    return {
      status: 'ok',
      providers: listProviderStatuses(settings, this.env, raw.providers),
    };
  }

  listProviderCatalog(): ListProviderCatalogResult {
    return { status: 'ok', providers: listBuiltinProviderCatalog() };
  }

  listAvailableModels(): ListAvailableModelsResult {
    const settings = this.readResolvedSettings();
    if (isSettingsFailure(settings)) return settings;
    return {
      status: 'ok',
      models: listAvailableModelsFromSettings(settings),
    };
  }

  getProviderSettings(request: GetProviderSettingsRequest): GetProviderSettingsResult {
    const parsed = GetProviderSettingsRequestSchema.safeParse(request);
    if (!parsed.success) {
      return failed('provider_request_invalid', 'Provider settings request is invalid.', {
        issues: parsed.error.issues,
      });
    }

    const settings = this.readResolvedSettings();
    if (isSettingsFailure(settings)) return settings;
    const provider = settings.providers[parsed.data.provider_id];
    if (!provider) {
      return failed('provider_unknown', 'Provider settings were not found.', {
        provider_id: parsed.data.provider_id,
      });
    }

    return {
      status: 'ok',
      provider,
    };
  }

  updateProviderSettings(request: UpdateProviderSettingsRequest): UpdateProviderSettingsResult {
    const parsed = UpdateProviderSettingsRequestSchema.safeParse(request);
    if (!parsed.success) {
      return failed('provider_update_invalid', 'Provider settings update is invalid.', {
        issues: parsed.error.issues,
      });
    }

    const updated = this.updateSettings({
      patch: {
        providers: {
          [parsed.data.provider_id]: parsed.data.patch,
        },
      },
    });
    if (updated.status === 'failed') return updated;

    return {
      status: 'updated',
      provider: updated.settings.providers[parsed.data.provider_id],
    };
  }

  deleteProviderSettings(request: DeleteProviderSettingsRequest): DeleteProviderSettingsResult {
    const parsed = DeleteProviderSettingsRequestSchema.safeParse(request);
    if (!parsed.success) {
      return failed('provider_delete_invalid', 'Provider delete request is invalid.', {
        issues: parsed.error.issues,
      });
    }

    const raw = this.readRawSettings();
    if (isSettingsFailure(raw)) return raw;
    if (!raw.providers?.[parsed.data.provider_id]) {
      return failed('provider_unknown', 'Provider settings were not found.', {
        provider_id: parsed.data.provider_id,
      });
    }

    const nextProviders = { ...raw.providers };
    delete nextProviders[parsed.data.provider_id];
    const next = SettingsRawSchema.parse({
      ...raw,
      providers: nextProviders,
    });
    this.options.file_store.writeRawSettings(next);

    return {
      status: 'deleted',
      provider_id: parsed.data.provider_id,
    };
  }

  setProviderApiKey(request: SetProviderApiKeyRequest): SetProviderApiKeyResult {
    const parsed = SetProviderApiKeyRequestSchema.safeParse(request);
    if (!parsed.success) {
      return failed('provider_api_key_invalid', 'Provider API key request is invalid.', {
        issues: parsed.error.issues,
      });
    }

    const updated = this.updateSettings({
      patch: {
        providers: {
          [parsed.data.provider_id]: {
            api_key: parsed.data.api_key,
          },
        },
      },
    });
    if (updated.status === 'failed') return updated;

    return {
      status: 'updated',
      provider: updated.settings.providers[parsed.data.provider_id],
    };
  }

  clearProviderApiKey(request: ClearProviderApiKeyRequest): ClearProviderApiKeyResult {
    const parsed = ClearProviderApiKeyRequestSchema.safeParse(request);
    if (!parsed.success) {
      return failed('provider_api_key_clear_invalid', 'Provider API key clear request is invalid.', {
        issues: parsed.error.issues,
      });
    }

    const updated = this.updateSettings({
      patch: {
        providers: {
          [parsed.data.provider_id]: {
            api_key: null,
          },
        },
      },
    });
    if (updated.status === 'failed') return updated;

    return {
      status: 'updated',
      provider: updated.settings.providers[parsed.data.provider_id],
    };
  }

  resolveProviderRuntimeConfig(
    request: ResolveProviderRuntimeConfigRequest,
  ): ResolveProviderRuntimeConfigResult {
    const settings = this.readResolvedSettings();
    if (isSettingsFailure(settings)) return settings;
    return resolveProviderRuntimeConfigFromSettings(settings, request, this.env);
  }

  resolveModelContextSettings(
    request: ResolveProviderRuntimeConfigRequest,
  ): ResolveModelContextSettingsResult {
    const settings = this.readResolvedSettings();
    if (isSettingsFailure(settings)) return settings;
    return resolveModelContextSettingsFromSettings(settings, request);
  }

  getWebSearchSettings(): GetWebSearchSettingsResult {
    const settings = this.readResolvedSettings();
    if (isSettingsFailure(settings)) return settings;
    const search = settings.web.search;
    const credential = resolveWebSearchCredential(search.provider, search.api_key, search.api_key_env, this.env);
    return {
      status: 'ok',
      settings: {
        ...(search.provider ? { provider: search.provider } : {}),
        ...(search.base_url ? { base_url: search.base_url } : {}),
        has_api_key: Boolean(credential.apiKey),
        credential_source: credential.source,
        ...(credential.envName ? { api_key_env: credential.envName } : {}),
      },
    };
  }

  resolveWebSearchRuntimeConfig(): ResolveWebSearchRuntimeConfigResult {
    const settings = this.readResolvedSettings();
    if (isSettingsFailure(settings)) return settings;
    const search = settings.web.search;
    if (!search.provider) return { status: 'unconfigured' };
    if (search.provider === 'custom' && !search.base_url) return { status: 'unconfigured' };
    const credential = resolveWebSearchCredential(search.provider, search.api_key, search.api_key_env, this.env);
    if (!credential.apiKey) return { status: 'unconfigured' };
    return {
      status: 'configured',
      config: {
        provider: search.provider,
        api_key: credential.apiKey,
        ...(search.base_url ? { base_url: search.base_url } : {}),
      },
    };
  }

  resolvePermissionSettings(request: ResolvePermissionSettingsRequest): ResolvePermissionSettingsResult {
    const parsed = ResolvePermissionSettingsRequestSchema.safeParse(request);
    if (!parsed.success) {
      return failed('permission_settings_request_invalid', 'Permission settings request is invalid.', {
        issues: parsed.error.issues,
      });
    }

    const settings = this.readResolvedSettings();
    if (isSettingsFailure(settings)) return settings;
    return resolvePermissionSettingsFromResolvedSettings(settings, parsed.data);
  }

  addPermissionRules(request: AddPermissionRulesRequest): AddPermissionRulesResult {
    const parsed = AddPermissionRulesRequestSchema.safeParse(request);
    if (!parsed.success) {
      return failed('permission_rule_invalid', 'Permission rule is invalid.', {
        issues: parsed.error.issues,
      });
    }

    const raw = this.readRawSettings();
    if (isSettingsFailure(raw)) return raw;
    const result = addPermissionRulesToRawSettings(raw, parsed.data);
    if (result.status !== 'patch') {
      return result;
    }

    const next = mergeRawSettings(raw, result.patch);
    try {
      this.options.file_store.writeRawSettings(next);
      return {
        status: 'saved',
        settings: resolveSettings(next),
      };
    } catch (error) {
      return failed('settings_write_failed', 'Permission rules could not be saved.', toFailureDetails(error));
    }
  }

  changePermissionRules(request: ChangePermissionRulesRequest): ChangePermissionRulesResult {
    const parsed = ChangePermissionRulesRequestSchema.safeParse(request);
    if (!parsed.success) return failed('permission_rule_invalid', 'Permission rule change is invalid.', { issues: parsed.error.issues });
    const raw = this.readRawSettings();
    if (isSettingsFailure(raw)) return raw;
    const result = changePermissionRulesInRawSettings(raw, parsed.data);
    if (result.status !== 'patch') return result;
    const next = mergeRawSettings(raw, result.patch);
    try {
      this.options.file_store.writeRawSettings(next);
      return { status: 'saved', settings: resolveSettings(next) };
    } catch (error) {
      return failed('settings_write_failed', 'Permission rules could not be saved.', toFailureDetails(error));
    }
  }

  private readRawSettings(): SettingsRawSchemaResult {
    try {
      const original = this.options.file_store.readRawSettings();
      const migrated = migrateLegacyProviderApis(original);
      const parsed = SettingsRawSchema.parse(migrated.value);
      if (migrated.changed) this.options.file_store.writeRawSettings(parsed);
      return parsed;
    } catch (error) {
      return settingsFailure('settings_raw_invalid', 'Raw settings are invalid.', toFailureDetails(error));
    }
  }

  private readResolvedSettings() {
    const raw = this.readRawSettings();
    if (isSettingsFailure(raw)) return raw;
    try {
      return resolveSettings(raw);
    } catch (error) {
      return failed('settings_resolution_failed', 'Settings could not be resolved.', toFailureDetails(error));
    }
  }

  private now(): string {
    return this.options.now?.() ?? new Date().toISOString();
  }
}

function resolveWebSearchCredential(
  provider: WebSearchProvider | undefined,
  configuredApiKey: string | undefined,
  configuredEnvName: string | undefined,
  env: EnvMap,
): { apiKey?: string; source: 'settings' | 'environment' | 'missing'; envName?: string } {
  const apiKey = configuredApiKey?.trim();
  if (apiKey) return { apiKey, source: 'settings' };
  const envName = configuredEnvName ?? (provider && provider !== 'custom'
    ? DEFAULT_WEB_SEARCH_API_KEY_ENV[provider]
    : undefined);
  const envApiKey = envName ? env[envName]?.trim() : undefined;
  return envApiKey
    ? { apiKey: envApiKey, source: 'environment', envName }
    : { source: 'missing', ...(envName ? { envName } : {}) };
}

type SettingsRawSchemaResult = ReturnType<typeof SettingsRawSchema.parse> | { status: 'failed'; failure: SettingsError };

function failed<T extends { status: string } = never>(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): T | { status: 'failed'; failure: SettingsError } {
  return {
    status: 'failed',
    failure: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  };
}

function settingsFailure(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): { status: 'failed'; failure: SettingsError } {
  return {
    status: 'failed',
    failure: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  };
}

function isSettingsFailure(value: unknown): value is { status: 'failed'; failure: SettingsError } {
  return Boolean(
    value
    && typeof value === 'object'
    && 'status' in value
    && (value as { status: unknown }).status === 'failed',
  );
}

function materializeSettingsForWrite(raw: SettingsRaw): SettingsRaw {
  const resolved = resolveSettings(raw);
  return SettingsRawSchema.parse({
    ...raw,
    context: resolved.context,
    ...(raw.providers
      ? {
          providers: Object.fromEntries(Object.keys(raw.providers).map((providerId) => [
            providerId,
            providerSettingsForWrite(resolved.providers[providerId], raw.providers?.[providerId]),
          ])),
        }
      : {}),
  });
}

function providerSettingsForWrite(provider: ProviderSettingsResolved, raw?: ProviderSettingsRaw) {
  return {
    enabled: provider.enabled,
    api: provider.api,
    display_name: provider.display_name,
    ...(provider.base_url ? { base_url: provider.base_url } : {}),
    models: Object.fromEntries(Object.entries(provider.models).map(([modelId, model]) => [
      modelId,
      {
        ...(raw?.models?.[modelId]?.display_name
          ? { display_name: raw.models[modelId].display_name }
          : {}),
        context_window_tokens: model.context_window_tokens,
        max_output_tokens: model.max_output_tokens,
        ...(raw?.models?.[modelId]?.capabilities
          ? { capabilities: raw.models[modelId].capabilities }
          : {}),
      },
    ])),
    ...(provider.api_key ? { api_key: provider.api_key } : {}),
    ...(provider.api_key_env ? { api_key_env: provider.api_key_env } : {}),
  };
}

function migrateLegacyProviderApis(value: unknown): { value: unknown; changed: boolean } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { value, changed: false };
  const root = value as Record<string, unknown>;
  if (!root.providers || typeof root.providers !== 'object' || Array.isArray(root.providers)) {
    return { value, changed: false };
  }
  let changed = false;
  const providers = Object.fromEntries(Object.entries(root.providers as Record<string, unknown>).map(([id, entry]) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [id, entry];
    const provider = { ...(entry as Record<string, unknown>) };
    if (provider.api === undefined && provider.protocol === 'openai-compatible') {
      provider.api = 'openai-completions';
      changed = true;
    } else if (provider.api === undefined && provider.protocol === 'anthropic') {
      provider.api = 'anthropic-messages';
      changed = true;
    }
    if ('protocol' in provider) {
      delete provider.protocol;
      changed = true;
    }
    return [id, provider];
  }));
  return changed ? { value: { ...root, providers }, changed: true } : { value, changed: false };
}

function toFailureDetails(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      message: error.message,
    };
  }
  return {
    error: String(error),
  };
}
