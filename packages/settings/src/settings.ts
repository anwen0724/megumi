/* Implements the unified Settings capability over a secret-bearing file model. */
import { emptySettingsEnvironment, type SettingsEnvironment } from './settings-environment';
import {
  CompleteSetupRequestSchema,
  SettingsFileRawSchema,
  UpdateSettingsRequestSchema,
  createSettingsFailure,
  type CompleteSetupRequest,
  type CompleteSetupResult,
  type DeleteApiKeyResult,
  type ReadApiKeyResult,
  type SettingsFailureResult,
  type SettingsFileRaw,
  type SettingsRaw,
  type SettingsResolved,
  type UpdateSettingsRequest,
  type UpdateSettingsResult,
  type WriteApiKeyResult,
} from './settings-schema';

import {
  definedObject,
  materializeFileForWrite,
  mergeFileWithPublicPatch,
  publicRawFromFile,
  resolvePublicSettings,
} from './settings-file-model';
import type { SettingsStore } from './settings-store';
import {
  DeleteProviderApiKeyRequestSchema,
  DeleteProviderSettingsRequestSchema,
  GetProviderSettingsRequestSchema,
  ReadProviderApiKeyRequestSchema,
  ResolveProviderSettingsRequestSchema,
  UpdateProviderSettingsRequestSchema,
  WriteProviderApiKeyRequestSchema,
  listAvailableModels as listAvailableModelsFromProviders,
  listProviderCatalog as listProviderCatalogFromAi,
  listProviderStatuses,
  readProviderApiKey as readProviderCredential,
  resolveProviderConfig,
  type DeleteProviderApiKeyRequest,
  type DeleteProviderSettingsRequest,
  type DeleteProviderSettingsResult,
  type GetProviderSettingsRequest,
  type GetProviderSettingsResult,
  type ListAvailableModelsResult,
  type ListProviderSettingsResult,
  type ProviderCatalogDefinition,
  type ProviderSettingsFileRaw,
  type ProviderSettingsRaw,
  type ReadProviderApiKeyRequest,
  type ResolveProviderSettingsRequest,
  type ResolveProviderSettingsResult,
  type UpdateProviderSettingsRequest,
  type UpdateProviderSettingsResult,
  type WriteProviderApiKeyRequest,
} from './provider-settings';
import {
  ResolveModelSettingsRequestSchema,
  resolveModelConfig,
  type ResolveModelSettingsRequest,
  type ResolveModelSettingsResult,
} from './model-settings';
import {
  AddPermissionRulesRequestSchema,
  ChangePermissionRulesRequestSchema,
  ResolvePermissionSettingsRequestSchema,
  addPermissionRulesPatch,
  changePermissionRulesPatch,
  resolvePermissionSettings,
  type AddPermissionRulesRequest,
  type AddPermissionRulesResult,
  type ChangePermissionRulesRequest,
  type ChangePermissionRulesResult,
  type PermissionSettings,
  type ResolvePermissionSettingsRequest,
} from './permission-settings';
import {
  DeleteWebSearchApiKeyRequestSchema,
  ReadWebSearchApiKeyRequestSchema,
  WriteWebSearchApiKeyRequestSchema,
  readWebSearchApiKey as readWebSearchCredential,
  resolveWebSearchSettings,
  type DeleteWebSearchApiKeyRequest,
  type ReadWebSearchApiKeyRequest,
  type ResolveWebSearchSettingsResult,
  type WriteWebSearchApiKeyRequest,
} from './web-search-settings';

export interface CreateSettingsRequest {
  readonly store: SettingsStore;
  readonly environment?: SettingsEnvironment;
  readonly now?: () => string;
}

export interface Settings {
  read(): { status: 'ok'; settings: SettingsRaw } | SettingsFailureResult;
  resolve(): { status: 'ok'; settings: SettingsResolved } | SettingsFailureResult;
  update(request: UpdateSettingsRequest): UpdateSettingsResult;
  completeSetup(request: CompleteSetupRequest): CompleteSetupResult;

  listProviders(): ListProviderSettingsResult;
  listProviderCatalog(): readonly ProviderCatalogDefinition[];
  listAvailableModels(): ListAvailableModelsResult;
  getProvider(request: GetProviderSettingsRequest): GetProviderSettingsResult;
  updateProvider(request: UpdateProviderSettingsRequest): UpdateProviderSettingsResult;
  deleteProvider(request: DeleteProviderSettingsRequest): DeleteProviderSettingsResult;
  resolveProvider(request: ResolveProviderSettingsRequest): ResolveProviderSettingsResult;
  resolveModel(request: ResolveModelSettingsRequest): ResolveModelSettingsResult;

  resolvePermissions(
    request?: ResolvePermissionSettingsRequest,
  ): { status: 'ok'; settings: PermissionSettings } | SettingsFailureResult;
  addPermissionRules(request: AddPermissionRulesRequest): AddPermissionRulesResult;
  changePermissionRules(request: ChangePermissionRulesRequest): ChangePermissionRulesResult;
  resolveWebSearch(): ResolveWebSearchSettingsResult;

  readProviderApiKey(request: ReadProviderApiKeyRequest): ReadApiKeyResult;
  writeProviderApiKey(request: WriteProviderApiKeyRequest): WriteApiKeyResult;
  deleteProviderApiKey(request: DeleteProviderApiKeyRequest): DeleteApiKeyResult;
  readWebSearchApiKey(request: ReadWebSearchApiKeyRequest): ReadApiKeyResult;
  writeWebSearchApiKey(request: WriteWebSearchApiKeyRequest): WriteApiKeyResult;
  deleteWebSearchApiKey(request: DeleteWebSearchApiKeyRequest): DeleteApiKeyResult;
}

export function createSettings(request: CreateSettingsRequest): Settings {
  return new DefaultSettings(request);
}

class DefaultSettings implements Settings {
  private readonly environment: SettingsEnvironment;

  constructor(private readonly request: CreateSettingsRequest) {
    this.environment = request.environment ?? emptySettingsEnvironment;
  }

  read(): { status: 'ok'; settings: SettingsRaw } | SettingsFailureResult {
    try {
      return { status: 'ok', settings: publicRawFromFile(this.readFile()) };
    } catch {
      return failure('settings_read_failed', 'Settings could not be read.');
    }
  }

  resolve(): { status: 'ok'; settings: SettingsResolved } | SettingsFailureResult {
    try {
      return { status: 'ok', settings: resolvePublicSettings(publicRawFromFile(this.readFile())) };
    } catch {
      return failure('settings_resolution_failed', 'Settings could not be resolved.');
    }
  }

  update(request: UpdateSettingsRequest): UpdateSettingsResult {
    const parsed = UpdateSettingsRequestSchema.safeParse(request);
    if (!parsed.success) return failure('settings_patch_invalid', 'Settings patch is invalid.');
    try {
      const next = materializeFileForWrite(mergeFileWithPublicPatch(this.readFile(), parsed.data.patch));
      this.request.store.write(next);
      return { status: 'updated', settings: resolvePublicSettings(publicRawFromFile(next)) };
    } catch {
      return writeFailure('settings_write_failed', 'Settings could not be saved.');
    }
  }

  completeSetup(request: CompleteSetupRequest): CompleteSetupResult {
    const parsed = CompleteSetupRequestSchema.safeParse(request);
    if (!parsed.success) return failure('setup_completion_invalid', 'Setup completion request is invalid.');
    const provider = parsed.data.provider;
    const result = this.update({
      patch: {
        ...(parsed.data.language ? { language: parsed.data.language } : {}),
        ...(parsed.data.theme ? { theme: parsed.data.theme } : {}),
        setup: { completed: true, completed_at: this.now() },
        ...(provider ? {
          providers: {
            [provider.provider_id]: {
              ...(provider.enabled !== undefined ? { enabled: provider.enabled } : {}),
              ...(provider.api ? { api: provider.api } : {}),
              ...(provider.display_name ? { display_name: provider.display_name } : {}),
              ...(provider.base_url ? { base_url: provider.base_url } : {}),
              ...(provider.models
                ? { models: Object.fromEntries(provider.models.map((modelId) => [modelId, {}])) }
                : {}),
              ...(provider.api_key_env !== undefined ? { api_key_env: provider.api_key_env } : {}),
            },
          },
        } : {}),
      },
    });
    return result.status === 'failed'
      ? result
      : { status: 'completed', settings: result.settings };
  }

  listProviders(): ListProviderSettingsResult {
    try {
      const file = this.readFile();
      const raw = publicRawFromFile(file);
      const resolved = resolvePublicSettings(raw);
      return {
        status: 'ok',
        providers: listProviderStatuses(
          resolved.providers,
          raw.providers ?? {},
          file.providers ?? {},
          this.environment,
        ),
      };
    } catch {
      return failure('settings_read_failed', 'Provider settings could not be read.');
    }
  }

  listProviderCatalog(): readonly ProviderCatalogDefinition[] {
    return listProviderCatalogFromAi();
  }

  listAvailableModels(): ListAvailableModelsResult {
    const resolved = this.resolve();
    if (resolved.status === 'failed') return resolved;
    try {
      return { status: 'ok', models: listAvailableModelsFromProviders(resolved.settings.providers) };
    } catch {
      return failure('settings_read_failed', 'Available models could not be read.');
    }
  }

  getProvider(request: GetProviderSettingsRequest): GetProviderSettingsResult {
    const parsed = GetProviderSettingsRequestSchema.safeParse(request);
    if (!parsed.success) return failure('provider_request_invalid', 'Provider settings request is invalid.');
    const resolved = this.resolve();
    if (resolved.status === 'failed') return resolved;
    const provider = resolved.settings.providers[parsed.data.provider_id];
    return provider
      ? { status: 'ok', provider }
      : failure('provider_unknown', 'Provider settings were not found.');
  }

  updateProvider(request: UpdateProviderSettingsRequest): UpdateProviderSettingsResult {
    const parsed = UpdateProviderSettingsRequestSchema.safeParse(request);
    if (!parsed.success) return failure('provider_update_invalid', 'Provider settings update is invalid.');
    const updated = this.update({
      patch: { providers: { [parsed.data.provider_id]: parsed.data.patch } },
    });
    return updated.status === 'failed'
      ? updated
      : { status: 'updated', provider: updated.settings.providers[parsed.data.provider_id]! };
  }

  deleteProvider(request: DeleteProviderSettingsRequest): DeleteProviderSettingsResult {
    const parsed = DeleteProviderSettingsRequestSchema.safeParse(request);
    if (!parsed.success) return failure('provider_delete_invalid', 'Provider delete request is invalid.');
    try {
      const file = this.readFile();
      if (!file.providers?.[parsed.data.provider_id]) {
        return failure('provider_unknown', 'Provider settings were not found.');
      }
      const providers = { ...file.providers };
      delete providers[parsed.data.provider_id];
      this.request.store.write(SettingsFileRawSchema.parse({ ...file, providers }));
      return { status: 'deleted', provider_id: parsed.data.provider_id };
    } catch {
      return writeFailure('settings_write_failed', 'Provider settings could not be deleted.');
    }
  }

  resolveProvider(request: ResolveProviderSettingsRequest): ResolveProviderSettingsResult {
    const parsed = ResolveProviderSettingsRequestSchema.safeParse(request);
    if (!parsed.success) return failure('provider_request_invalid', 'Provider resolution request is invalid.');
    const resolved = this.resolve();
    if (resolved.status === 'failed') return resolved;
    const result = resolveProviderConfig(resolved.settings.providers, parsed.data);
    if (result.status === 'error') return domainFailure(result.settingsCode, result.message);
    return result;
  }

  resolveModel(request: ResolveModelSettingsRequest): ResolveModelSettingsResult {
    const parsed = ResolveModelSettingsRequestSchema.safeParse(request);
    if (!parsed.success) return failure('model_request_invalid', 'Model settings request is invalid.');
    const resolved = this.resolve();
    if (resolved.status === 'failed') return resolved;
    const result = resolveModelConfig(resolved.settings.providers, resolved.settings.context, parsed.data);
    return result.status === 'error' ? domainFailure(result.settingsCode, result.message) : result;
  }

  resolvePermissions(
    request: ResolvePermissionSettingsRequest = {},
  ): { status: 'ok'; settings: PermissionSettings } | SettingsFailureResult {
    const parsed = ResolvePermissionSettingsRequestSchema.safeParse(request);
    if (!parsed.success) {
      return failure('permission_settings_request_invalid', 'Permission settings request is invalid.');
    }
    const resolved = this.resolve();
    if (resolved.status === 'failed') return resolved;
    return { status: 'ok', settings: resolvePermissionSettings(resolved.settings.permissions, parsed.data) };
  }

  addPermissionRules(request: AddPermissionRulesRequest): AddPermissionRulesResult {
    const parsed = AddPermissionRulesRequestSchema.safeParse(request);
    if (!parsed.success) return failure('permission_rule_invalid', 'Permission rule is invalid.');
    const read = this.read();
    if (read.status === 'failed') return read;
    const patch = addPermissionRulesPatch(read.settings, parsed.data);
    if (patch.status === 'error') return domainFailure(patch.settingsCode, patch.message);
    const updated = this.update({ patch: patch.patch });
    return updated.status === 'failed'
      ? updated
      : { status: 'saved', settings: updated.settings };
  }

  changePermissionRules(request: ChangePermissionRulesRequest): ChangePermissionRulesResult {
    const parsed = ChangePermissionRulesRequestSchema.safeParse(request);
    if (!parsed.success) return failure('permission_rule_invalid', 'Permission rule change is invalid.');
    const read = this.read();
    if (read.status === 'failed') return read;
    const patch = changePermissionRulesPatch(read.settings, parsed.data);
    if (patch.status === 'error') return domainFailure(patch.settingsCode, patch.message);
    const updated = this.update({ patch: patch.patch });
    return updated.status === 'failed'
      ? updated
      : { status: 'saved', settings: updated.settings };
  }

  resolveWebSearch(): ResolveWebSearchSettingsResult {
    try {
      const file = this.readFile();
      return {
        status: 'ok',
        settings: resolveWebSearchSettings(
          resolvePublicSettings(publicRawFromFile(file)).web.search,
          file.web?.search ?? {},
          this.environment,
        ),
      };
    } catch {
      return failure('settings_read_failed', 'Web Search settings could not be resolved.');
    }
  }

  readProviderApiKey(request: ReadProviderApiKeyRequest): ReadApiKeyResult {
    const parsed = ReadProviderApiKeyRequestSchema.safeParse(request);
    if (!parsed.success) return failure('provider_api_key_request_invalid', 'Provider API key request is invalid.');
    try {
      return readProviderCredential(this.readFile().providers?.[parsed.data.provider_id], this.environment);
    } catch {
      return failure('settings_read_failed', 'Provider API key could not be read.');
    }
  }

  writeProviderApiKey(request: WriteProviderApiKeyRequest): WriteApiKeyResult {
    const parsed = WriteProviderApiKeyRequestSchema.safeParse(request);
    if (!parsed.success) return failure('provider_api_key_invalid', 'Provider API key request is invalid.');
    try {
      const file = this.readFile();
      const providers = {
        ...(file.providers ?? {}),
        [parsed.data.provider_id]: {
          ...(file.providers?.[parsed.data.provider_id] ?? {}),
          api_key: parsed.data.api_key,
        },
      };
      this.request.store.write(materializeFileForWrite(SettingsFileRawSchema.parse({ ...file, providers })));
      return { status: 'updated' };
    } catch {
      return writeFailure('settings_write_failed', 'Provider API key could not be saved.');
    }
  }

  deleteProviderApiKey(request: DeleteProviderApiKeyRequest): DeleteApiKeyResult {
    const parsed = DeleteProviderApiKeyRequestSchema.safeParse(request);
    if (!parsed.success) return failure('provider_api_key_delete_invalid', 'Provider API key delete request is invalid.');
    try {
      const file = this.readFile();
      const current = file.providers?.[parsed.data.provider_id];
      if (current) {
        const provider = { ...current };
        delete provider.api_key;
        this.request.store.write(SettingsFileRawSchema.parse({
          ...file,
          providers: { ...file.providers, [parsed.data.provider_id]: provider },
        }));
      }
      return { status: 'deleted' };
    } catch {
      return writeFailure('settings_write_failed', 'Provider API key could not be deleted.');
    }
  }

  readWebSearchApiKey(request: ReadWebSearchApiKeyRequest): ReadApiKeyResult {
    if (!ReadWebSearchApiKeyRequestSchema.safeParse(request).success) {
      return failure('web_search_api_key_request_invalid', 'Web Search API key request is invalid.');
    }
    try {
      return readWebSearchCredential(this.readFile().web?.search ?? {}, this.environment);
    } catch {
      return failure('settings_read_failed', 'Web Search API key could not be read.');
    }
  }

  writeWebSearchApiKey(request: WriteWebSearchApiKeyRequest): WriteApiKeyResult {
    const parsed = WriteWebSearchApiKeyRequestSchema.safeParse(request);
    if (!parsed.success) return failure('web_search_api_key_invalid', 'Web Search API key request is invalid.');
    try {
      const file = this.readFile();
      this.request.store.write(SettingsFileRawSchema.parse({
        ...file,
        web: {
          ...(file.web ?? {}),
          search: { ...(file.web?.search ?? {}), api_key: parsed.data.api_key },
        },
      }));
      return { status: 'updated' };
    } catch {
      return writeFailure('settings_write_failed', 'Web Search API key could not be saved.');
    }
  }

  deleteWebSearchApiKey(request: DeleteWebSearchApiKeyRequest): DeleteApiKeyResult {
    if (!DeleteWebSearchApiKeyRequestSchema.safeParse(request).success) {
      return failure('web_search_api_key_delete_invalid', 'Web Search API key delete request is invalid.');
    }
    try {
      const file = this.readFile();
      if (file.web?.search) {
        const search = { ...file.web.search };
        delete search.api_key;
        this.request.store.write(SettingsFileRawSchema.parse({
          ...file,
          web: { ...file.web, search },
        }));
      }
      return { status: 'deleted' };
    } catch {
      return writeFailure('settings_write_failed', 'Web Search API key could not be deleted.');
    }
  }

  private readFile(): SettingsFileRaw {
    // Legacy normalization and write-back live in the file layer (store).
    return SettingsFileRawSchema.parse(this.request.store.read());
  }

  private now(): string {
    return this.request.now?.() ?? new Date().toISOString();
  }
}

function failure(settingsCode: string, message: string): SettingsFailureResult {
  return createSettingsFailure(settingsCode, message);
}

function domainFailure(settingsCode: string, message: string): SettingsFailureResult {
  if (settingsCode === 'provider_disabled') {
    return createSettingsFailure(settingsCode, message, { code: 'provider_disabled' });
  }
  if (settingsCode === 'provider_model_unknown') {
    return createSettingsFailure(settingsCode, message, { code: 'provider_invalid_model' });
  }
  return failure(settingsCode, message);
}

function writeFailure(settingsCode: string, message: string): SettingsFailureResult {
  return createSettingsFailure(settingsCode, message, {
    code: 'filesystem_error',
    source: 'filesystem',
    retryable: true,
  });
}

