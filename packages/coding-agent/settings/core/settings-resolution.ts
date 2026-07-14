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
import type {
  ProviderModelSettingsRaw,
  ProviderSettingsRaw,
} from '../contracts/provider-settings-contracts';
import { getAiModelDefinition, getAiProviderDefinition } from '@megumi/ai';

export const DEFAULT_UNKNOWN_MODEL_CONTEXT_WINDOW_TOKENS = 256_000;

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
      context: parsed.context
        ? {
            ...DEFAULT_SETTINGS.context,
            ...definedObject(parsed.context),
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
      context: patchParsed.context
        ? {
            ...(currentParsed.context ?? {}),
            ...definedObject(patchParsed.context),
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
    }).map(([providerId]) => [providerId, resolveProvider(providerId, providers[providerId] ?? {})]),
  );
}

function resolveProvider(providerId: string, raw: ProviderSettingsRaw) {
  const definition = getAiProviderDefinition(providerId);
  const models: Record<string, ProviderModelSettingsRaw> = raw.models ?? Object.fromEntries(
    definition?.models.map((model) => [model.modelId, {}]) ?? [],
  );
  return {
    enabled: raw.enabled ?? true,
    protocol: raw.protocol ?? definition?.protocol ?? 'openai-compatible',
    display_name: raw.display_name ?? definition?.displayName ?? providerId,
    ...(raw.base_url ?? definition?.defaultBaseUrl
      ? { base_url: raw.base_url ?? definition?.defaultBaseUrl }
      : {}),
    models: Object.fromEntries(Object.entries(models).map(([modelId, model]) => {
      const known = getAiModelDefinition(providerId, modelId);
      const configured = model.context_window_tokens;
      return [
        modelId,
        {
          context_window_tokens: known
            ? Math.min(configured ?? known.contextWindowTokens, known.contextWindowTokens)
            : configured ?? DEFAULT_UNKNOWN_MODEL_CONTEXT_WINDOW_TOKENS,
          capabilities: {
            ...(known?.capabilities ?? {}),
            ...(model.capabilities ?? {}),
          },
        },
      ];
    })),
    ...definedCredentialSettings(raw),
  };
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

function definedCredentialSettings(value: ProviderSettingsRaw) {
  const defined = definedObject(value);
  delete defined.enabled;
  delete defined.protocol;
  delete defined.display_name;
  delete defined.base_url;
  delete defined.models;
  if (defined.api_key === null) {
    delete defined.api_key;
  }
  if (defined.api_key_env === null) {
    delete defined.api_key_env;
  }
  return defined;
}

function definedObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as Partial<T>;
}
