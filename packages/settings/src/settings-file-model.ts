/* Owns settings file model transformations: secret stripping, patch merging, and write materialization. */
import {
  DEFAULT_SETTINGS,
  SettingsFileRawSchema,
  SettingsRawReadSchema,
  SettingsResolvedSchema,
  type SettingsFileRaw,
  type SettingsRaw,
  type SettingsResolved,
} from './settings-schema';
import {
  ProviderSettingsFileRawSchema,
  materializeProviderSettings,
  resolveProviderSettings,
  type ProviderSettingsFileRaw,
} from './provider-settings';
import {
  WebSearchSettingsFileRawSchema,
  type WebSearchSettingsFileRaw,
} from './web-search-settings';

// Strict variants detect unknown keys while the tolerant file schemas keep reading.
const STRICT_FILE_SCHEMA = SettingsFileRawSchema.strict();
const STRICT_PROVIDER_SCHEMA = ProviderSettingsFileRawSchema.strict();
const STRICT_WEB_SEARCH_SCHEMA = WebSearchSettingsFileRawSchema.strict();

/** Strips the secret-bearing fields, producing the public SettingsRaw view. */
export function publicRawFromFile(file: SettingsFileRaw): SettingsRaw {
  return SettingsRawReadSchema.parse({
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

/** Merges a public patch into the file model, honoring null-delete and undefined-skip semantics. */
export function mergeFileWithPublicPatch(file: SettingsFileRaw, patch: SettingsRaw): SettingsFileRaw {
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
      voice: patch.voice ? { ...(file.voice ?? {}), ...definedObject(patch.voice) } : undefined,
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

/** Materializes defaults for write so the persisted file matches the resolved shape. */
export function materializeFileForWrite(file: SettingsFileRaw): SettingsFileRaw {
  const publicRaw = publicRawFromFile(file);
  const resolved = resolvePublicSettings(publicRaw);
  return SettingsFileRawSchema.parse({
    ...file,
    context: resolved.context,
    ...(file.voice ? { voice: withoutLegacyVoiceKeys(file.voice) } : {}),
    ...(file.providers ? {
      providers: Object.fromEntries(Object.entries(file.providers).map(([providerId, provider]) => {
        const publicProvider = publicRaw.providers?.[providerId] ?? {};
        // Spread the file entry first so user-added provider fields survive.
        return [providerId, {
          ...provider,
          ...materializeProviderSettings(providerId, publicProvider),
        }];
      })),
    } : {}),
  });
}

/** Merges defaults into a public SettingsRaw, producing the consumer-facing SettingsResolved. */
export function resolvePublicSettings(raw: SettingsRaw): SettingsResolved {
  const providers = Object.fromEntries(
    Object.entries(raw.providers ?? {}).map(([providerId, provider]) => [
      providerId,
      resolveProviderSettings(providerId, provider),
    ]),
  );
  // Whitelist the search fields: tolerated unknown keys must not leak into
  // the strict consumer-facing resolved model.
  const rawSearch = raw.web?.search ?? {};
  const search = definedObject({
    provider: rawSearch.provider,
    api_key_env: rawSearch.api_key_env,
    base_url: rawSearch.base_url,
  });
  if (search.api_key_env === null) delete search.api_key_env;
  if (search.base_url === null) delete search.base_url;
  // Whitelist the voice fields: the legacy output device key is tolerated in
  // the file model but must not leak into the strict resolved model.
  const rawVoice = raw.voice ?? {};
  const voice = definedObject({
    input_device_id: rawVoice.input_device_id,
    recognition_language: rawVoice.recognition_language,
  });
  return SettingsResolvedSchema.parse({
    ...DEFAULT_SETTINGS,
    ...(raw.language ? { language: raw.language } : {}),
    ...(raw.theme ? { theme: raw.theme } : {}),
    ...(raw.setup ? { setup: { ...DEFAULT_SETTINGS.setup, ...definedObject(raw.setup) } } : {}),
    ...(raw.memory ? { memory: { ...DEFAULT_SETTINGS.memory, ...definedObject(raw.memory) } } : {}),
    ...(raw.voice ? { voice: { ...DEFAULT_SETTINGS.voice, ...voice } } : {}),
    ...(raw.context ? { context: { ...DEFAULT_SETTINGS.context, ...definedObject(raw.context) } } : {}),
    ...(raw.model_selection ? { model_selection: raw.model_selection } : {}),
    web: { search },
    providers,
    ...(raw.permissions
      ? { permissions: { ...DEFAULT_SETTINGS.permissions, ...definedObject(raw.permissions) } }
      : {}),
  });
}

/** Lists unknown keys in a parsed file model so callers can surface them as diagnostics. */
export function collectUnknownFileKeys(file: SettingsFileRaw): string[] {
  const keys: string[] = [];
  for (const issue of STRICT_FILE_SCHEMA.safeParse(file).error?.issues ?? []) {
    if (issue.code === 'unrecognized_keys') keys.push(...issue.keys);
  }
  for (const [providerId, provider] of Object.entries(file.providers ?? {})) {
    for (const issue of STRICT_PROVIDER_SCHEMA.safeParse(provider).error?.issues ?? []) {
      if (issue.code === 'unrecognized_keys') {
        keys.push(...issue.keys.map((key) => `providers.${providerId}.${key}`));
      }
    }
  }
  if (file.web?.search) {
    for (const issue of STRICT_WEB_SEARCH_SCHEMA.safeParse(file.web.search).error?.issues ?? []) {
      if (issue.code === 'unrecognized_keys') {
        keys.push(...issue.keys.map((key) => `web.search.${key}`));
      }
    }
  }
  return keys;
}

export function definedObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as Partial<T>;
}

function withoutWebSearchSecret(search: WebSearchSettingsFileRaw) {
  const { api_key: _secret, ...publicSearch } = search;
  return publicSearch;
}

/** Drops the output device key removed with the TTS implementation before persisting. */
function withoutLegacyVoiceKeys(voice: NonNullable<SettingsFileRaw['voice']>) {
  const { output_device_id: _legacy, ...current } = voice;
  return current;
}
