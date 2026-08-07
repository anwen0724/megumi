/* Owns settings.json legacy format normalization and migration. */
import { z } from 'zod';
import type { SettingsFileRaw } from './settings-schema';

export interface NormalizeSettingsFileResult {
  readonly value: unknown;
  readonly changed: boolean;
}

/** Applies every legacy normalization in order and reports whether the file changed. */
export function normalizeSettingsFile(value: unknown): NormalizeSettingsFileResult {
  const withoutCompaction = withoutObsoleteCompaction(value);
  const withModels = normalizeLegacyProviderModels(withoutCompaction);
  const withApis = normalizeLegacyProviderApis(withModels);
  return { value: withApis, changed: !structurallyEqual(withApis, value) };
}

/** Converts a legacy AppSettings file into the current settings.json file model. */
export function legacyAppSettingsToFileRaw(raw: unknown): SettingsFileRaw {
  return appRawToSettingsFileRaw(AppSettingsRawSchema.parse(raw));
}

function withoutObsoleteCompaction(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const { compaction: _obsoleteCompaction, ...settings } = value;
  return settings;
}

function normalizeLegacyProviderModels(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.providers)) return value;
  return {
    ...value,
    providers: Object.fromEntries(Object.entries(value.providers).map(([providerId, provider]) => {
      if (!isRecord(provider)) return [providerId, provider];
      return [providerId, {
        ...provider,
        ...(Array.isArray(provider.models)
          ? {
              models: Object.fromEntries(
                provider.models
                  .filter((model): model is string => typeof model === 'string')
                  .map((model) => [model, {}]),
              ),
            }
          : {}),
      }];
    })),
  };
}

function normalizeLegacyProviderApis(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.providers)) return value;
  return {
    ...value,
    providers: Object.fromEntries(Object.entries(value.providers).map(([providerId, entry]) => {
      if (!isRecord(entry)) return [providerId, entry];
      const provider = { ...entry };
      if (provider.api === undefined && provider.protocol === 'openai-compatible') {
        provider.api = 'openai-completions';
      } else if (provider.api === undefined && provider.protocol === 'anthropic') {
        provider.api = 'anthropic-messages';
      }
      delete provider.protocol;
      return [providerId, provider];
    })),
  };
}

function appRawToSettingsFileRaw(raw: AppSettingsRaw): SettingsFileRaw {
  return {
    ...(raw.language ? { language: raw.language } : {}),
    ...(raw.theme ? { theme: raw.theme } : {}),
    ...(raw.setup ? {
      setup: {
        ...(raw.setup.completed !== undefined ? { completed: raw.setup.completed } : {}),
        ...(raw.setup.completedAt ? { completed_at: raw.setup.completedAt } : {}),
      },
    } : {}),
    ...(raw.memory ? { memory: raw.memory } : {}),
    ...(raw.providers ? {
      providers: Object.fromEntries(Object.entries(raw.providers).map(([providerId, provider]) => [
        providerId,
        {
          ...(provider.enabled !== undefined ? { enabled: provider.enabled } : {}),
          ...(provider.protocol ? { api: legacyProviderApi(provider.protocol) } : {}),
          ...(provider.displayName ? { display_name: provider.displayName } : {}),
          ...(provider.baseUrl ? { base_url: provider.baseUrl } : {}),
          ...(provider.models
            ? { models: Object.fromEntries(provider.models.map((modelId) => [modelId, {}])) }
            : {}),
          ...(provider.apiKey !== undefined ? { api_key: provider.apiKey } : {}),
          ...(provider.apiKeyEnv !== undefined ? { api_key_env: provider.apiKeyEnv } : {}),
        },
      ])),
    } : {}),
  };
}

const LegacyAppSetupSettingsRawSchema = z.object({
  completed: z.boolean().optional(),
  completedAt: z.string().datetime().optional(),
}).strict();
const LegacyAppProviderSettingsRawSchema = z.object({
  enabled: z.boolean().optional(),
  protocol: z.enum(['openai-compatible', 'anthropic']).optional(),
  displayName: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  models: z.array(z.string().min(1)).optional(),
  apiKey: z.string().min(1).nullable().optional(),
  apiKeyEnv: z.string().min(1).nullable().optional(),
}).strict();
const AppSettingsRawSchema = z.object({
  language: z.enum(['zh-CN', 'en-US']).optional(),
  theme: z.enum([
    'megumi-warm',
    'neutral-light',
    'graphite-dark',
    'sage-mist',
    'midnight-blue',
  ]).optional(),
  setup: LegacyAppSetupSettingsRawSchema.optional(),
  memory: z.object({ enabled: z.boolean().optional() }).strict().optional(),
  providers: z.record(z.string().min(1), LegacyAppProviderSettingsRawSchema).optional(),
}).strict();
type AppSettingsRaw = z.infer<typeof AppSettingsRawSchema>;

function legacyProviderApi(protocol: 'openai-compatible' | 'anthropic') {
  return protocol === 'anthropic' ? 'anthropic-messages' : 'openai-completions';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function structurallyEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
