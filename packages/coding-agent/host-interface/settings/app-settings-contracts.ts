/*
 * Defines host-facing settings payloads used by IPC/UI shells.
 * These contracts adapt Settings-owned snake_case facts to the existing app API.
 */
import { z } from 'zod';
import {
  DEFAULT_SETTINGS,
  MemorySettingsRawSchema,
  MemorySettingsResolvedSchema,
  SettingsLanguageSchema,
  type SettingsLanguage,
  SettingsThemeNameSchema,
  type SettingsThemeName,
} from '../../settings';

export type AppLanguage = SettingsLanguage;
export type AppThemeName = SettingsThemeName;

export const AppSetupSettingsRawSchema = z
  .object({
    completed: z.boolean().optional(),
    completedAt: z.string().datetime().optional(),
  })
  .strict();

export const AppMemorySettingsRawSchema = MemorySettingsRawSchema;

export const AppCompactionSettingsRawSchema = z
  .object({
    enabled: z.boolean().optional(),
    reserveTokens: z.number().int().positive().optional(),
    keepRecentTokens: z.number().int().positive().optional(),
  })
  .strict();

export const AppProviderSettingsRawSchema = z
  .object({
    enabled: z.boolean().optional(),
    kind: z.enum(['openai-compatible', 'openai', 'anthropic']).optional(),
    displayName: z.string().min(1).optional(),
    baseUrl: z.string().url().optional(),
    models: z.array(z.string().min(1)).optional(),
    apiKey: z.string().min(1).nullable().optional(),
    apiKeyEnv: z.string().min(1).nullable().optional(),
  })
  .strict();

export const AppSettingsRawSchema = z
  .object({
    language: SettingsLanguageSchema.optional(),
    theme: SettingsThemeNameSchema.optional(),
    setup: AppSetupSettingsRawSchema.optional(),
    memory: AppMemorySettingsRawSchema.optional(),
    compaction: AppCompactionSettingsRawSchema.optional(),
    providers: z.record(z.string().min(1), AppProviderSettingsRawSchema).optional(),
  })
  .strict();

export const AppSetupSettingsResolvedSchema = z
  .object({
    completed: z.boolean(),
    completedAt: z.string().datetime().optional(),
  })
  .strict();

export const AppMemorySettingsResolvedSchema = MemorySettingsResolvedSchema;

export const AppCompactionSettingsResolvedSchema = z
  .object({
    enabled: z.boolean(),
    reserveTokens: z.number().int().positive(),
    keepRecentTokens: z.number().int().positive(),
  })
  .strict();

export const AppProviderSettingsResolvedSchema = z
  .object({
    enabled: z.boolean(),
    kind: z.enum(['openai-compatible', 'openai', 'anthropic']),
    displayName: z.string().min(1),
    baseUrl: z.string().url().optional(),
    models: z.array(z.string().min(1)),
    apiKeyEnv: z.string().min(1).optional(),
  })
  .strict();

export const AppSettingsResolvedSchema = z
  .object({
    language: SettingsLanguageSchema,
    theme: SettingsThemeNameSchema,
    setup: AppSetupSettingsResolvedSchema,
    memory: AppMemorySettingsResolvedSchema,
    compaction: AppCompactionSettingsResolvedSchema,
    providers: z.record(z.string().min(1), AppProviderSettingsResolvedSchema),
  })
  .strict();

export type AppSettingsRaw = z.infer<typeof AppSettingsRawSchema>;
export type AppSettingsResolved = z.infer<typeof AppSettingsResolvedSchema>;

export const DEFAULT_APP_SETTINGS = AppSettingsResolvedSchema.parse({
  language: DEFAULT_SETTINGS.language,
  theme: DEFAULT_SETTINGS.theme,
  setup: {
    completed: DEFAULT_SETTINGS.setup.completed,
    ...(DEFAULT_SETTINGS.setup.completed_at ? { completedAt: DEFAULT_SETTINGS.setup.completed_at } : {}),
  },
  memory: DEFAULT_SETTINGS.memory,
  compaction: {
    enabled: DEFAULT_SETTINGS.compaction.enabled,
    reserveTokens: DEFAULT_SETTINGS.compaction.reserve_tokens,
    keepRecentTokens: DEFAULT_SETTINGS.compaction.keep_recent_tokens,
  },
  providers: Object.fromEntries(Object.entries(DEFAULT_SETTINGS.providers).map(([providerId, provider]) => [
    providerId,
    {
      enabled: provider.enabled,
      kind: provider.kind,
      displayName: provider.display_name,
      ...(provider.base_url ? { baseUrl: provider.base_url } : {}),
      models: provider.models,
      ...(provider.api_key_env ? { apiKeyEnv: provider.api_key_env } : {}),
    },
  ])),
} satisfies AppSettingsResolved);
