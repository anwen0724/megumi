/* Owns settings file model transformations: secret stripping, patch merging, and write materialization. */
import {
  DEFAULT_SETTINGS,
  SettingsFileRawSchema,
  SettingsRawSchema,
  SettingsResolvedSchema,
  type SettingsFileRaw,
  type SettingsRaw,
  type SettingsResolved,
} from './settings-schema';
import {
  materializeProviderSettings,
  resolveProviderSettings,
} from './provider-settings';
import type { WebSearchSettingsFileRaw } from './web-search-settings';

/** Strips the secret-bearing fields, producing the public SettingsRaw view. */
export function publicRawFromFile(file: SettingsFileRaw): SettingsRaw {
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

/** Merges defaults into a public SettingsRaw, producing the consumer-facing SettingsResolved. */
export function resolvePublicSettings(raw: SettingsRaw): SettingsResolved {
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

export function definedObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as Partial<T>;
}

function withoutWebSearchSecret(search: WebSearchSettingsFileRaw) {
  const { api_key: _secret, ...publicSearch } = search;
  return publicSearch;
}
