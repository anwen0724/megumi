/* Implements the unified Settings capability over a secret-bearing file model. */
import { emptySettingsEnvironment, type SettingsEnvironment } from './settings-environment';
import {
  CompleteSetupRequestSchema,
  DEFAULT_SETTINGS,
  SettingsFileRawSchema,
  SettingsRawSchema,
  SettingsResolvedSchema,
  UpdateSettingsRequestSchema,
  createSettingsFailure,
  type CompleteSetupRequest,
  type CompleteSetupResult,
  type DeleteApiKeyResult,
  type ReadApiKeyResult,
  type SettingsFailureResult,
  type SettingsFailure,
  type SettingsFileRaw,
  type SettingsRaw,
  type SettingsResolved,
  type UpdateSettingsRequest,
  type UpdateSettingsResult,
  type WriteApiKeyResult,
} from './settings-schema';
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
  materializeProviderSettings,
  readProviderApiKey as readProviderCredential,
  resolveProviderConfig,
  resolveProviderSettings,
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
  type WebSearchSettingsFileRaw,
  type WriteWebSearchApiKeyRequest,
} from './web-search-settings';

export interface CreateSettingsRequest {
  readonly store: SettingsStore;
  readonly environment?: SettingsEnvironment;
  readonly now?: () => string;
}

export interface Settings {
  read(): SettingsRaw;
  resolve(): SettingsResolved;
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

  resolvePermissions(request?: ResolvePermissionSettingsRequest): PermissionSettings;
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

export class SettingsOperationError extends Error {
  readonly failure: SettingsFailure;

  constructor(failure: SettingsFailure) {
    super(failure.message);
    this.name = 'SettingsOperationError';
    this.failure = failure;
  }
}

export function createSettings(request: CreateSettingsRequest): Settings {
  return new DefaultSettings(request);
}

class DefaultSettings implements Settings {
  private readonly environment: SettingsEnvironment;

  constructor(private readonly request: CreateSettingsRequest) {
    this.environment = request.environment ?? emptySettingsEnvironment;
  }

  read(): SettingsRaw {
    try {
      return publicRawFromFile(this.readFile());
    } catch {
      throw operationError('settings_read_failed', 'Settings could not be read.');
    }
  }

  resolve(): SettingsResolved {
    try {
      return resolvePublicSettings(publicRawFromFile(this.readFile()));
    } catch {
      throw operationError('settings_resolution_failed', 'Settings could not be resolved.');
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
    try {
      return { status: 'ok', models: listAvailableModelsFromProviders(this.resolve().providers) };
    } catch {
      return failure('settings_read_failed', 'Available models could not be read.');
    }
  }

  getProvider(request: GetProviderSettingsRequest): GetProviderSettingsResult {
    const parsed = GetProviderSettingsRequestSchema.safeParse(request);
    if (!parsed.success) return failure('provider_request_invalid', 'Provider settings request is invalid.');
    try {
      const provider = this.resolve().providers[parsed.data.provider_id];
      return provider
        ? { status: 'ok', provider }
        : failure('provider_unknown', 'Provider settings were not found.');
    } catch {
      return failure('settings_read_failed', 'Provider settings could not be read.');
    }
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
    try {
      const result = resolveProviderConfig(this.resolve().providers, parsed.data);
      if (result.status === 'error') return domainFailure(result.settingsCode, result.message);
      return result;
    } catch {
      return failure('settings_read_failed', 'Provider settings could not be resolved.');
    }
  }

  resolveModel(request: ResolveModelSettingsRequest): ResolveModelSettingsResult {
    const parsed = ResolveModelSettingsRequestSchema.safeParse(request);
    if (!parsed.success) return failure('model_request_invalid', 'Model settings request is invalid.');
    try {
      const resolved = this.resolve();
      const result = resolveModelConfig(resolved.providers, resolved.context, parsed.data);
      return result.status === 'error' ? domainFailure(result.settingsCode, result.message) : result;
    } catch {
      return failure('settings_read_failed', 'Model settings could not be resolved.');
    }
  }

  resolvePermissions(request: ResolvePermissionSettingsRequest = {}): PermissionSettings {
    const parsed = ResolvePermissionSettingsRequestSchema.safeParse(request);
    if (!parsed.success) throw operationError('permission_settings_request_invalid', 'Permission settings request is invalid.');
    return resolvePermissionSettings(this.resolve().permissions, parsed.data);
  }

  addPermissionRules(request: AddPermissionRulesRequest): AddPermissionRulesResult {
    const parsed = AddPermissionRulesRequestSchema.safeParse(request);
    if (!parsed.success) return failure('permission_rule_invalid', 'Permission rule is invalid.');
    let raw: SettingsRaw;
    try {
      raw = this.read();
    } catch {
      return failure('settings_read_failed', 'Permission settings could not be read.');
    }
    const patch = addPermissionRulesPatch(raw, parsed.data);
    if (patch.status === 'error') return domainFailure(patch.settingsCode, patch.message);
    const updated = this.update({ patch: patch.patch });
    return updated.status === 'failed'
      ? updated
      : { status: 'saved', settings: updated.settings };
  }

  changePermissionRules(request: ChangePermissionRulesRequest): ChangePermissionRulesResult {
    const parsed = ChangePermissionRulesRequestSchema.safeParse(request);
    if (!parsed.success) return failure('permission_rule_invalid', 'Permission rule change is invalid.');
    let raw: SettingsRaw;
    try {
      raw = this.read();
    } catch {
      return failure('settings_read_failed', 'Permission settings could not be read.');
    }
    const patch = changePermissionRulesPatch(raw, parsed.data);
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
    const migrated = migrateLegacyProviderApis(this.request.store.read());
    const parsed = SettingsFileRawSchema.parse(migrated.value);
    if (migrated.changed) this.request.store.write(parsed);
    return parsed;
  }

  private now(): string {
    return this.request.now?.() ?? new Date().toISOString();
  }
}

function resolvePublicSettings(raw: SettingsRaw): SettingsResolved {
  const providers = Object.fromEntries(
    Object.entries(raw.providers ?? {}).map(([providerId, provider]) => [
      providerId,
      resolveProviderSettings(providerId, provider),
    ]),
  );
  const search = definedObject(raw.web?.search ?? {});
  if (search.api_key_env === null) delete search.api_key_env;
  if (search.base_url === null) delete search.base_url;
  return SettingsResolvedSchema.parse({
    ...DEFAULT_SETTINGS,
    ...(raw.language ? { language: raw.language } : {}),
    ...(raw.theme ? { theme: raw.theme } : {}),
    ...(raw.setup ? { setup: { ...DEFAULT_SETTINGS.setup, ...definedObject(raw.setup) } } : {}),
    ...(raw.memory ? { memory: { ...DEFAULT_SETTINGS.memory, ...definedObject(raw.memory) } } : {}),
    ...(raw.context ? { context: { ...DEFAULT_SETTINGS.context, ...definedObject(raw.context) } } : {}),
    ...(raw.model_selection ? { model_selection: raw.model_selection } : {}),
    web: { search },
    providers,
    ...(raw.permissions
      ? { permissions: { ...DEFAULT_SETTINGS.permissions, ...definedObject(raw.permissions) } }
      : {}),
  });
}

function publicRawFromFile(file: SettingsFileRaw): SettingsRaw {
  return SettingsRawSchema.parse({
    ...file,
    ...(file.providers ? {
      providers: Object.fromEntries(Object.entries(file.providers).map(([providerId, provider]) => {
        const { api_key: _secret, ...publicProvider } = provider;
        return [providerId, publicProvider];
      })),
    } : {}),
    ...(file.web?.search ? {
      web: {
        ...file.web,
        search: withoutWebSearchSecret(file.web.search),
      },
    } : {}),
  });
}

function mergeFileWithPublicPatch(file: SettingsFileRaw, patch: SettingsRaw): SettingsFileRaw {
  const providers = patch.providers
    ? Object.fromEntries(Object.entries({ ...(file.providers ?? {}), ...patch.providers }).map(([providerId]) => [
        providerId,
        patch.providers?.[providerId]
          ? { ...(file.providers?.[providerId] ?? {}), ...definedObject(patch.providers[providerId]) }
          : file.providers?.[providerId],
      ]))
    : file.providers;
  const searchPatch = patch.web?.search;
  const search = searchPatch
    ? { ...(file.web?.search ?? {}), ...definedObject(searchPatch) }
    : file.web?.search;
  if (search && searchPatch?.api_key_env === null) delete search.api_key_env;
  if (search && searchPatch?.base_url === null) delete search.base_url;
  return SettingsFileRawSchema.parse({
    ...file,
    ...definedObject({
      language: patch.language,
      theme: patch.theme,
      setup: patch.setup ? { ...(file.setup ?? {}), ...definedObject(patch.setup) } : undefined,
      memory: patch.memory ? { ...(file.memory ?? {}), ...definedObject(patch.memory) } : undefined,
      context: patch.context ? { ...(file.context ?? {}), ...definedObject(patch.context) } : undefined,
      model_selection: patch.model_selection,
      web: patch.web ? { ...(file.web ?? {}), ...(search ? { search } : {}) } : undefined,
      providers,
      permissions: patch.permissions
        ? { ...(file.permissions ?? {}), ...definedObject(patch.permissions) }
        : undefined,
    }),
  });
}

function materializeFileForWrite(file: SettingsFileRaw): SettingsFileRaw {
  const publicRaw = publicRawFromFile(file);
  const resolved = resolvePublicSettings(publicRaw);
  return SettingsFileRawSchema.parse({
    ...file,
    context: resolved.context,
    ...(file.providers ? {
      providers: Object.fromEntries(Object.entries(file.providers).map(([providerId, provider]) => {
        const publicProvider = publicRaw.providers?.[providerId] ?? {};
        return [providerId, {
          ...materializeProviderSettings(providerId, publicProvider),
          ...(provider.api_key ? { api_key: provider.api_key } : {}),
        }];
      })),
    } : {}),
  });
}

function withoutWebSearchSecret(search: WebSearchSettingsFileRaw) {
  const { api_key: _secret, ...publicSearch } = search;
  return publicSearch;
}

function migrateLegacyProviderApis(value: unknown): { value: unknown; changed: boolean } {
  if (!isRecord(value) || !isRecord(value.providers)) return { value, changed: false };
  let changed = false;
  const providers = Object.fromEntries(Object.entries(value.providers).map(([id, entry]) => {
    if (!isRecord(entry)) return [id, entry];
    const provider = { ...entry };
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
  return changed ? { value: { ...value, providers }, changed: true } : { value, changed: false };
}

function operationError(settingsCode: string, message: string): SettingsOperationError {
  return new SettingsOperationError(failure(settingsCode, message).failure);
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

function definedObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as Partial<T>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
