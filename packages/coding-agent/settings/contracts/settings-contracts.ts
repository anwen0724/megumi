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
import {
  WebSearchSettingsRawSchema,
  WebSearchSettingsResolvedSchema,
} from './web-search-settings-contracts';

export const SettingsThemeNameSchema = z.enum([
  'megumi-warm',
  'neutral-light',
  'graphite-dark',
  'sage-mist',
  'midnight-blue',
]);
export type SettingsThemeName = z.infer<typeof SettingsThemeNameSchema>;

export const SettingsLanguageSchema = z.enum(['zh-CN', 'en-US']);
export type SettingsLanguage = z.infer<typeof SettingsLanguageSchema>;

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

export const SettingsRawSchema = z
  .object({
    language: SettingsLanguageSchema.optional(),
    theme: SettingsThemeNameSchema.optional(),
    setup: SetupSettingsRawSchema.optional(),
    memory: MemorySettingsRawSchema.optional(),
    web: z.object({ search: WebSearchSettingsRawSchema.optional() }).strict().optional(),
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

export const SettingsResolvedSchema = z
  .object({
    language: SettingsLanguageSchema,
    theme: SettingsThemeNameSchema,
    setup: SetupSettingsResolvedSchema,
    memory: MemorySettingsResolvedSchema,
    web: z.object({ search: WebSearchSettingsResolvedSchema }).strict(),
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
  web: {
    search: {},
  },
  providers: {},
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

export const CompleteSetupProviderRequestSchema = z
  .object({
    provider_id: z.string().min(1),
    enabled: z.boolean().optional(),
    protocol: z.enum(['openai-compatible', 'anthropic']).optional(),
    display_name: z.string().min(1).optional(),
    base_url: z.string().url().optional(),
    models: z.array(z.string().min(1)).optional(),
    api_key: z.string().min(1).optional(),
    api_key_env: z.string().min(1).nullable().optional(),
  })
  .strict();

export const CompleteSetupRequestSchema = z
  .object({
    language: SettingsLanguageSchema.optional(),
    theme: SettingsThemeNameSchema.optional(),
    provider: CompleteSetupProviderRequestSchema.optional(),
  })
  .strict();
export type CompleteSetupRequest = z.infer<typeof CompleteSetupRequestSchema>;

export type CompleteSetupResult =
  | { status: 'completed'; settings: SettingsResolved }
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
