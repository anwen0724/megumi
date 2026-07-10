/*
 * Public Settings Service that reads sparse raw settings, resolves product settings,
 * and exposes provider runtime and permission settings capabilities to callers.
 */
import type { RuntimeError } from '../../events';
import {
  mergeRawSettings,
  resolveSettings,
} from '../core/settings-resolution';
import {
  listAvailableModels as listAvailableModelsFromSettings,
  listProviderStatuses,
  resolveProviderRuntimeConfig as resolveProviderRuntimeConfigFromSettings,
} from '../core/provider-settings-resolution';
import {
  addPermissionRuleToRawSettings,
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
  type ListProviderSettingsResult,
  type ResolveProviderRuntimeConfigRequest,
  type ResolveProviderRuntimeConfigResult,
  type SetProviderApiKeyRequest,
  type SetProviderApiKeyResult,
  type UpdateProviderSettingsRequest,
  type UpdateProviderSettingsResult,
} from '../contracts/provider-settings-contracts';
import {
  AddPermissionRuleRequestSchema,
  ResolvePermissionSettingsRequestSchema,
  type AddPermissionRuleRequest,
  type AddPermissionRuleResult,
  type ResolvePermissionSettingsRequest,
  type ResolvePermissionSettingsResult,
} from '../contracts/permission-settings-contracts';

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
  listAvailableModels(): ListAvailableModelsResult;
  getProviderSettings(request: GetProviderSettingsRequest): GetProviderSettingsResult;
  updateProviderSettings(request: UpdateProviderSettingsRequest): UpdateProviderSettingsResult;
  deleteProviderSettings(request: DeleteProviderSettingsRequest): DeleteProviderSettingsResult;
  setProviderApiKey(request: SetProviderApiKeyRequest): SetProviderApiKeyResult;
  clearProviderApiKey(request: ClearProviderApiKeyRequest): ClearProviderApiKeyResult;
  resolveProviderRuntimeConfig(
    request: ResolveProviderRuntimeConfigRequest,
  ): ResolveProviderRuntimeConfigResult;

  resolvePermissionSettings(request: ResolvePermissionSettingsRequest): ResolvePermissionSettingsResult;
  addPermissionRule(request: AddPermissionRuleRequest): AddPermissionRuleResult;
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

    const next = mergeRawSettings(raw, parsed.data.patch);
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
            ...(parsed.data.provider.protocol ? { protocol: parsed.data.provider.protocol } : {}),
            ...(parsed.data.provider.display_name ? { display_name: parsed.data.provider.display_name } : {}),
            ...(parsed.data.provider.base_url ? { base_url: parsed.data.provider.base_url } : {}),
            ...(parsed.data.provider.models ? { models: parsed.data.provider.models } : {}),
            ...(parsed.data.provider.api_key ? { api_key: parsed.data.provider.api_key } : {}),
            ...(parsed.data.provider.api_key_env !== undefined ? { api_key_env: parsed.data.provider.api_key_env } : {}),
          },
        }
      : undefined;

    const next = mergeRawSettings(raw, {
      ...(parsed.data.language ? { language: parsed.data.language } : {}),
      ...(parsed.data.theme ? { theme: parsed.data.theme } : {}),
      setup: {
        completed: true,
        completed_at: this.now(),
      },
      ...(providerPatch ? { providers: providerPatch } : {}),
    });
    this.options.file_store.writeRawSettings(next);
    return {
      status: 'completed',
      settings: resolveSettings(next),
    };
  }

  listProviderSettings(): ListProviderSettingsResult {
    const settings = this.readResolvedSettings();
    if (isSettingsFailure(settings)) return settings;
    return {
      status: 'ok',
      providers: listProviderStatuses(settings, this.env),
    };
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

  addPermissionRule(request: AddPermissionRuleRequest): AddPermissionRuleResult {
    const parsed = AddPermissionRuleRequestSchema.safeParse(request);
    if (!parsed.success) {
      return failed('permission_rule_invalid', 'Permission rule is invalid.', {
        issues: parsed.error.issues,
      });
    }

    const raw = this.readRawSettings();
    if (isSettingsFailure(raw)) return raw;
    const result = addPermissionRuleToRawSettings(raw, parsed.data);
    if (result.status !== 'patch') {
      return result;
    }

    const next = mergeRawSettings(raw, result.patch);
    this.options.file_store.writeRawSettings(next);
    return {
      status: 'saved',
      settings: resolveSettings(next),
    };
  }

  private readRawSettings(): SettingsRawSchemaResult {
    try {
      return SettingsRawSchema.parse(this.options.file_store.readRawSettings());
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
