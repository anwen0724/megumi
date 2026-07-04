/*
 * Defines Settings-owned raw and resolved product settings contracts.
 * Raw settings are sparse settings.json overrides; resolved settings include defaults.
 */
import { z } from 'zod';
import {
  ProviderSettingsRawSchema,
  ProviderSettingsResolvedSchema,
} from './provider-settings-contracts';
import {
  PermissionRulesRawSchema,
  PermissionRulesResolvedSchema,
} from './permission-settings-contracts';

export const SettingsThemeNameSchema = z.enum([
  'megumi-warm',
  'neutral-light',
  'graphite-dark',
  'sage-mist',
  'midnight-blue',
]);
export type SettingsThemeName = z.infer<typeof SettingsThemeNameSchema>;
export type AppThemeName = SettingsThemeName;

export const SettingsLanguageSchema = z.enum(['zh-CN', 'en-US']);
export type SettingsLanguage = z.infer<typeof SettingsLanguageSchema>;
export type AppLanguage = SettingsLanguage;

export const SetupSettingsRawSchema = z
  .object({
    completed: z.boolean().optional(),
    completed_at: z.string().datetime().optional(),
  })
  .strict();
export type SetupSettingsRaw = z.infer<typeof SetupSettingsRawSchema>;

export const MemorySettingsRawSchema = z
  .object({
    enabled: z.boolean().optional(),
  })
  .strict();
export type MemorySettingsRaw = z.infer<typeof MemorySettingsRawSchema>;

export const CompactionSettingsRawSchema = z
  .object({
    enabled: z.boolean().optional(),
    reserve_tokens: z.number().int().positive().optional(),
    keep_recent_tokens: z.number().int().positive().optional(),
  })
  .strict();
export type CompactionSettingsRaw = z.infer<typeof CompactionSettingsRawSchema>;

export const SettingsRawSchema = z
  .object({
    language: SettingsLanguageSchema.optional(),
    theme: SettingsThemeNameSchema.optional(),
    setup: SetupSettingsRawSchema.optional(),
    memory: MemorySettingsRawSchema.optional(),
    compaction: CompactionSettingsRawSchema.optional(),
    providers: z.record(z.string().min(1), ProviderSettingsRawSchema).optional(),
    permissions: PermissionRulesRawSchema.optional(),
  })
  .strict();
export type SettingsRaw = z.infer<typeof SettingsRawSchema>;

export const SetupSettingsResolvedSchema = z
  .object({
    completed: z.boolean(),
    completed_at: z.string().datetime().optional(),
  })
  .strict();
export type SetupSettingsResolved = z.infer<typeof SetupSettingsResolvedSchema>;

export const MemorySettingsResolvedSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();
export type MemorySettingsResolved = z.infer<typeof MemorySettingsResolvedSchema>;

export const CompactionSettingsResolvedSchema = z
  .object({
    enabled: z.boolean(),
    reserve_tokens: z.number().int().positive(),
    keep_recent_tokens: z.number().int().positive(),
  })
  .strict();
export type CompactionSettingsResolved = z.infer<typeof CompactionSettingsResolvedSchema>;

export const SettingsResolvedSchema = z
  .object({
    language: SettingsLanguageSchema,
    theme: SettingsThemeNameSchema,
    setup: SetupSettingsResolvedSchema,
    memory: MemorySettingsResolvedSchema,
    compaction: CompactionSettingsResolvedSchema,
    providers: z.record(z.string().min(1), ProviderSettingsResolvedSchema),
    permissions: PermissionRulesResolvedSchema,
  })
  .strict();
export type SettingsResolved = z.infer<typeof SettingsResolvedSchema>;

export const DEFAULT_SETTINGS = SettingsResolvedSchema.parse({
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
    reserve_tokens: 16384,
    keep_recent_tokens: 20000,
  },
  providers: {
    deepseek: {
      enabled: true,
      kind: 'openai-compatible',
      display_name: 'DeepSeek',
      base_url: 'https://api.deepseek.com',
      models: ['deepseek-v4-flash'],
      api_key_env: 'DEEPSEEK_API_KEY',
    },
    openai: {
      enabled: true,
      kind: 'openai-compatible',
      display_name: 'OpenAI',
      base_url: 'https://api.openai.com/v1',
      models: ['gpt-5.5'],
      api_key_env: 'OPENAI_API_KEY',
    },
    anthropic: {
      enabled: false,
      kind: 'anthropic',
      display_name: 'Anthropic',
      models: ['claude-sonnet-4-6'],
      api_key_env: 'ANTHROPIC_API_KEY',
    },
    custom: {
      enabled: false,
      kind: 'openai-compatible',
      display_name: 'Third-party compatible',
      models: ['custom-model'],
    },
  },
  permissions: {
    allow: [],
    ask: [],
    deny: [],
  },
} satisfies SettingsResolved);

export interface SettingsFileStore {
  readRawSettings(): SettingsRaw;
  writeRawSettings(next: SettingsRaw): void;
}

export type SettingsError = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export type GetRawSettingsResult =
  | { status: 'ok'; settings: SettingsRaw }
  | { status: 'failed'; failure: SettingsError };

export type GetResolvedSettingsResult =
  | { status: 'ok'; settings: SettingsResolved }
  | { status: 'failed'; failure: SettingsError };

export const UpdateSettingsRequestSchema = z
  .object({
    patch: SettingsRawSchema,
  })
  .strict();
export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsRequestSchema>;

export type UpdateSettingsResult =
  | { status: 'updated'; settings: SettingsResolved }
  | { status: 'failed'; failure: SettingsError };

export interface MemorySettingsPort {
  isMemoryEnabled(): boolean;
}

export function resolveMemoryEnabled(provider?: MemorySettingsPort): boolean {
  if (!provider) {
    return false;
  }
  try {
    return provider.isMemoryEnabled();
  } catch {
    return false;
  }
}

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
    defaultModel: z.string().min(1).optional(),
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
    defaultModel: z.string().min(1),
    apiKey: z.string().min(1).optional(),
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
      defaultModel: provider.models[0] ?? providerId,
      ...(provider.api_key ? { apiKey: provider.api_key } : {}),
      ...(provider.api_key_env ? { apiKeyEnv: provider.api_key_env } : {}),
    },
  ])),
} satisfies AppSettingsResolved);
