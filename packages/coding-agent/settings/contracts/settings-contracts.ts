/*
 * Defines user-editable application settings contracts owned by the Coding Agent settings module.
 * Raw settings represent sparse settings.json overrides; resolved settings are defaults plus those overrides.
 */
import { z } from 'zod';
import {
  DEFAULT_PROVIDER_SETTINGS,
  PROVIDER_IDS,
  ProviderIdSchema,
  ProviderKindSchema,
} from '@megumi/shared/provider';
import { PermissionRulesSchema } from '@megumi/shared/permission';

export const AppThemeNameSchema = z.enum([
  'megumi-warm',
  'neutral-light',
  'graphite-dark',
  'sage-mist',
  'midnight-blue',
]);
export type AppThemeName = z.infer<typeof AppThemeNameSchema>;

export const AppLanguageSchema = z.enum(['zh-CN', 'en-US']);
export type AppLanguage = z.infer<typeof AppLanguageSchema>;

export const AppSetupSettingsRawSchema = z
  .object({
    completed: z.boolean().optional(),
    completedAt: z.string().datetime().optional(),
  })
  .strict();

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
    language: AppLanguageSchema.optional(),
    theme: AppThemeNameSchema.optional(),
    setup: AppSetupSettingsRawSchema.optional(),
    memory: AppMemorySettingsRawSchema.optional(),
    compaction: AppCompactionSettingsRawSchema.optional(),
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

export const AppSetupSettingsResolvedSchema = z
  .object({
    completed: z.boolean(),
    completedAt: z.string().datetime().optional(),
  })
  .strict();

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
    language: AppLanguageSchema,
    theme: AppThemeNameSchema,
    setup: AppSetupSettingsResolvedSchema,
    memory: AppMemorySettingsResolvedSchema,
    compaction: AppCompactionSettingsResolvedSchema,
    providers: AppProvidersSettingsResolvedSchema,
    permissions: PermissionRulesSchema,
  })
  .strict();
export type AppSettingsResolved = z.infer<typeof AppSettingsResolvedSchema>;

export const DEFAULT_APP_SETTINGS = AppSettingsResolvedSchema.parse({
  language: 'zh-CN',
  theme: 'midnight-blue',
  setup: {
    completed: false,
  },
  memory: {
    enabled: false,
  },
  compaction: {
    enabled: true,
    reserveTokens: 16384,
    keepRecentTokens: 20000,
  },
  providers: {
    deepseek: providerDefault('deepseek'),
    openai: providerDefault('openai'),
    anthropic: providerDefault('anthropic'),
    custom: providerDefault('custom'),
  },
  permissions: {},
} satisfies AppSettingsResolved);

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
