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
