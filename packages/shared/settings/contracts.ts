// Defines user-editable application settings contracts shared across Main, Preload, and Renderer.
// Raw settings represent sparse settings.json overrides; resolved settings are defaults plus those overrides.
import { z } from 'zod';
import {
  DEFAULT_PROVIDER_SETTINGS,
  PROVIDER_IDS,
  ProviderIdSchema,
  ProviderKindSchema,
} from '../provider';
import { PermissionRulesSchema } from '../permission';

export const AppThemeNameSchema = z.enum([
  'megumi-warm',
  'neutral-light',
  'graphite-dark',
  'sage-mist',
  'midnight-blue',
]);
export type AppThemeName = z.infer<typeof AppThemeNameSchema>;

export const AppMemorySettingsRawSchema = z
  .object({
    enabled: z.boolean().optional(),
  })
  .strict();

export const AppCompactionSettingsRawSchema = z
  .object({
    enabled: z.boolean().optional(),
    reserveTokens: z.number().int().positive().optional(),
    keepRecentTokens: z.number().int().positive().optional(),
  })
  .strict();

export const AppChatSettingsRawSchema = z
  .object({
    defaultProvider: ProviderIdSchema.optional(),
  })
  .strict();

export const AppProviderSettingsRawSchema = z
  .object({
    enabled: z.boolean().optional(),
    kind: ProviderKindSchema.optional(),
    displayName: z.string().min(1).optional(),
    baseUrl: z.string().url().optional(),
    defaultModel: z.string().min(1).optional(),
    apiKey: z.string().min(1).nullable().optional(),
    apiKeyEnv: z.string().min(1).nullable().optional(),
  })
  .strict();

export const AppProvidersSettingsRawSchema = z
  .object(Object.fromEntries(
    PROVIDER_IDS.map((providerId) => [providerId, AppProviderSettingsRawSchema.optional()]),
  ) as Record<(typeof PROVIDER_IDS)[number], z.ZodOptional<typeof AppProviderSettingsRawSchema>>)
  .strict();

export const AppSettingsRawSchema = z
  .object({
    theme: AppThemeNameSchema.optional(),
    memory: AppMemorySettingsRawSchema.optional(),
    compaction: AppCompactionSettingsRawSchema.optional(),
    chat: AppChatSettingsRawSchema.optional(),
    providers: AppProvidersSettingsRawSchema.optional(),
    permissions: PermissionRulesSchema.optional(),
  })
  .strict();
export type AppSettingsRaw = z.infer<typeof AppSettingsRawSchema>;

export const AppMemorySettingsResolvedSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();

export const AppCompactionSettingsResolvedSchema = z
  .object({
    enabled: z.boolean(),
    reserveTokens: z.number().int().positive(),
    keepRecentTokens: z.number().int().positive(),
  })
  .strict();

export const AppChatSettingsResolvedSchema = z
  .object({
    defaultProvider: ProviderIdSchema,
  })
  .strict();

export const AppProviderSettingsResolvedSchema = z
  .object({
    enabled: z.boolean(),
    kind: ProviderKindSchema,
    displayName: z.string().min(1),
    baseUrl: z.string().url().optional(),
    defaultModel: z.string().min(1),
    apiKey: z.string().min(1).optional(),
    apiKeyEnv: z.string().min(1).optional(),
  })
  .strict();

export const AppProvidersSettingsResolvedSchema = z
  .object(Object.fromEntries(
    PROVIDER_IDS.map((providerId) => [providerId, AppProviderSettingsResolvedSchema]),
  ) as Record<(typeof PROVIDER_IDS)[number], typeof AppProviderSettingsResolvedSchema>)
  .strict();

export const AppSettingsResolvedSchema = z
  .object({
    theme: AppThemeNameSchema,
    memory: AppMemorySettingsResolvedSchema,
    compaction: AppCompactionSettingsResolvedSchema,
    chat: AppChatSettingsResolvedSchema,
    providers: AppProvidersSettingsResolvedSchema,
    permissions: PermissionRulesSchema,
  })
  .strict();
export type AppSettingsResolved = z.infer<typeof AppSettingsResolvedSchema>;

export const DEFAULT_APP_SETTINGS = AppSettingsResolvedSchema.parse({
  theme: 'midnight-blue',
  memory: {
    enabled: false,
  },
  compaction: {
    enabled: true,
    reserveTokens: 16384,
    keepRecentTokens: 20000,
  },
  chat: {
    defaultProvider: 'deepseek',
  },
  providers: {
    deepseek: providerDefault('deepseek'),
    openai: providerDefault('openai'),
    anthropic: providerDefault('anthropic'),
  },
  permissions: {},
} satisfies AppSettingsResolved);

export function resolveAppSettings(raw: unknown): AppSettingsResolved {
  const parsed = AppSettingsRawSchema.parse(raw ?? {});
  return AppSettingsResolvedSchema.parse({
    ...DEFAULT_APP_SETTINGS,
    ...definedObject({
      theme: parsed.theme,
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
      chat: parsed.chat
        ? {
            ...DEFAULT_APP_SETTINGS.chat,
            ...definedObject(parsed.chat),
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
      theme: patchParsed.theme,
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
      chat: patchParsed.chat
        ? {
            ...(currentParsed.chat ?? {}),
            ...definedObject(patchParsed.chat),
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

function providerDefault(providerId: (typeof PROVIDER_IDS)[number]) {
  const defaults = DEFAULT_PROVIDER_SETTINGS[providerId];
  return AppProviderSettingsResolvedSchema.parse({
    enabled: defaults.enabled,
    kind: defaults.kind,
    displayName: defaults.displayName,
    ...(defaults.baseUrl ? { baseUrl: defaults.baseUrl } : {}),
    defaultModel: String(defaults.defaultModelId),
    ...(defaults.apiKey ? { apiKey: defaults.apiKey } : {}),
    ...(defaults.apiKeyEnv ? { apiKeyEnv: defaults.apiKeyEnv } : {}),
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
