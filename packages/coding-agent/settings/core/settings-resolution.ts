/*
 * Resolves and merges raw Settings-owned product settings without reading or writing settings.json.
 */
import {
  DEFAULT_SETTINGS,
  SettingsRawSchema,
  SettingsResolvedSchema,
  type SettingsRaw,
  type SettingsResolved,
} from '../contracts/settings-contracts';
import type { ProviderSettingsRaw } from '../contracts/provider-settings-contracts';

export function resolveSettings(raw: unknown): SettingsResolved {
  const parsed = SettingsRawSchema.parse(raw ?? {});
  return SettingsResolvedSchema.parse({
    ...DEFAULT_SETTINGS,
    ...definedObject({
      language: parsed.language,
      theme: parsed.theme,
      setup: parsed.setup
        ? {
            ...DEFAULT_SETTINGS.setup,
            ...definedObject(parsed.setup),
          }
        : undefined,
      memory: parsed.memory
        ? {
            ...DEFAULT_SETTINGS.memory,
            ...definedObject(parsed.memory),
          }
        : undefined,
      web: parsed.web
        ? {
            search: resolveNullableWebSearchSettings(parsed.web.search ?? {}),
          }
        : undefined,
      providers: parsed.providers
        ? resolveProviderSettings(parsed.providers)
        : undefined,
      permissions: parsed.permissions
        ? {
            ...DEFAULT_SETTINGS.permissions,
            ...definedObject(parsed.permissions),
          }
        : undefined,
    }),
  });
}

export function mergeRawSettings(current: SettingsRaw, patch: SettingsRaw): SettingsRaw {
  const currentParsed = SettingsRawSchema.parse(current);
  const patchParsed = SettingsRawSchema.parse(patch);
  return SettingsRawSchema.parse({
    ...currentParsed,
    ...definedObject({
      language: patchParsed.language,
      theme: patchParsed.theme,
      setup: patchParsed.setup
        ? {
            ...(currentParsed.setup ?? {}),
            ...definedObject(patchParsed.setup),
          }
        : undefined,
      memory: patchParsed.memory
        ? {
            ...(currentParsed.memory ?? {}),
            ...definedObject(patchParsed.memory),
          }
        : undefined,
      web: patchParsed.web
        ? {
            ...(currentParsed.web ?? {}),
            ...(patchParsed.web.search
              ? { search: mergeRawWebSearch(currentParsed.web?.search ?? {}, patchParsed.web.search) }
              : {}),
          }
        : undefined,
      providers: patchParsed.providers
        ? mergeRawProviders(currentParsed.providers ?? {}, patchParsed.providers)
        : undefined,
      permissions: patchParsed.permissions
        ? {
            ...(currentParsed.permissions ?? {}),
            ...definedObject(patchParsed.permissions),
          }
        : undefined,
    }),
  });
}

function mergeRawWebSearch(
  current: NonNullable<NonNullable<SettingsRaw['web']>['search']>,
  patch: NonNullable<NonNullable<SettingsRaw['web']>['search']>,
) {
  const merged = { ...current, ...definedObject(patch) };
  if (patch.api_key === null) delete merged.api_key;
  if (patch.api_key_env === null) delete merged.api_key_env;
  if (patch.base_url === null) delete merged.base_url;
  return merged;
}

function resolveNullableWebSearchSettings(
  value: NonNullable<NonNullable<SettingsRaw['web']>['search']>,
) {
  const resolved = definedObject(value);
  if (resolved.api_key === null) delete resolved.api_key;
  if (resolved.api_key_env === null) delete resolved.api_key_env;
  if (resolved.base_url === null) delete resolved.base_url;
  return resolved;
}

function resolveProviderSettings(providers: NonNullable<SettingsRaw['providers']>) {
  return Object.fromEntries(
    Object.entries({
      ...DEFAULT_SETTINGS.providers,
      ...providers,
    }).map(([providerId]) => [
      providerId,
      {
        ...(DEFAULT_SETTINGS.providers[providerId] ?? defaultProvider(providerId)),
        ...definedProviderOverride(providers[providerId] ?? {}),
      },
    ]),
  );
}

function mergeRawProviders(
  current: NonNullable<SettingsRaw['providers']>,
  patch: NonNullable<SettingsRaw['providers']>,
) {
  return Object.fromEntries(
    Object.entries({
      ...current,
      ...patch,
    }).map(([providerId]) => [
      providerId,
      patch[providerId]
        ? mergeRawProvider(current[providerId] ?? {}, patch[providerId])
        : current[providerId],
    ]),
  );
}

function mergeRawProvider(current: ProviderSettingsRaw, patch: ProviderSettingsRaw) {
  const merged = {
    ...current,
    ...definedObject(patch),
  };
  if (patch.api_key === null) {
    delete merged.api_key;
  }
  if (patch.api_key_env === null) {
    delete merged.api_key_env;
  }
  return merged;
}

function definedProviderOverride(value: ProviderSettingsRaw) {
  const defined = definedObject(value);
  if (defined.api_key === null) {
    delete defined.api_key;
  }
  if (defined.api_key_env === null) {
    delete defined.api_key_env;
  }
  return defined;
}

function defaultProvider(providerId: string) {
  return {
    enabled: false,
    protocol: 'openai-compatible',
    display_name: providerId,
    models: [],
  };
}

function definedObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as Partial<T>;
}
