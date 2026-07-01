/*
 * Resolves and merges raw application settings using the Settings module contracts.
 */
import { z } from 'zod';
import { PROVIDER_IDS } from '@megumi/shared/provider';
import {
  AppProviderSettingsRawSchema,
  AppProvidersSettingsRawSchema,
  AppProvidersSettingsResolvedSchema,
  AppSettingsRawSchema,
  AppSettingsResolvedSchema,
  DEFAULT_APP_SETTINGS,
  type AppSettingsRaw,
  type AppSettingsResolved,
} from '../contracts/settings-contracts';

export function resolveAppSettings(raw: unknown): AppSettingsResolved {
  const parsed = AppSettingsRawSchema.parse(raw ?? {});
  return AppSettingsResolvedSchema.parse({
    ...DEFAULT_APP_SETTINGS,
    ...definedObject({
      language: parsed.language,
      theme: parsed.theme,
      setup: parsed.setup
        ? {
            ...DEFAULT_APP_SETTINGS.setup,
            ...definedObject(parsed.setup),
          }
        : undefined,
      memory: parsed.memory
        ? {
            ...DEFAULT_APP_SETTINGS.memory,
            ...definedObject(parsed.memory),
          }
        : undefined,
      compaction: parsed.compaction
        ? {
            ...DEFAULT_APP_SETTINGS.compaction,
            ...definedObject(parsed.compaction),
          }
        : undefined,
      providers: parsed.providers
        ? resolveProviderSettings(parsed.providers)
        : undefined,
      permissions: parsed.permissions
        ? definedObject(parsed.permissions)
        : undefined,
    }),
  });
}

export function mergeRawAppSettings(current: AppSettingsRaw, patch: AppSettingsRaw): AppSettingsRaw {
  const currentParsed = AppSettingsRawSchema.parse(current);
  const patchParsed = AppSettingsRawSchema.parse(patch);
  return AppSettingsRawSchema.parse({
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
      compaction: patchParsed.compaction
        ? {
            ...(currentParsed.compaction ?? {}),
            ...definedObject(patchParsed.compaction),
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

function resolveProviderSettings(providers: NonNullable<AppSettingsRaw['providers']>) {
  return AppProvidersSettingsResolvedSchema.parse(Object.fromEntries(
    PROVIDER_IDS.map((providerId) => [
      providerId,
      {
        ...DEFAULT_APP_SETTINGS.providers[providerId],
        ...definedProviderOverride(providers[providerId] ?? {}),
      },
    ]),
  ));
}

function mergeRawProviders(
  current: NonNullable<AppSettingsRaw['providers']>,
  patch: NonNullable<AppSettingsRaw['providers']>,
) {
  return AppProvidersSettingsRawSchema.parse(Object.fromEntries(
    PROVIDER_IDS.map((providerId) => [
      providerId,
      patch[providerId]
        ? mergeRawProvider(current[providerId] ?? {}, patch[providerId])
        : current[providerId],
    ]),
  ));
}

function mergeRawProvider(
  current: z.infer<typeof AppProviderSettingsRawSchema>,
  patch: z.infer<typeof AppProviderSettingsRawSchema>,
) {
  const merged = {
    ...current,
    ...definedObject(patch),
  };
  if (patch.apiKey === null) {
    delete merged.apiKey;
  }
  if (patch.apiKeyEnv === null) {
    delete merged.apiKeyEnv;
  }
  return merged;
}

function definedProviderOverride(value: z.infer<typeof AppProviderSettingsRawSchema>) {
  const defined = definedObject(value);
  if (defined.apiKey === null) {
    delete defined.apiKey;
  }
  if (defined.apiKeyEnv === null) {
    delete defined.apiKeyEnv;
  }
  return defined;
}

function definedObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as Partial<T>;
}
