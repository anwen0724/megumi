/* Owns settings.json compatibility parsing and atomic local file replacement. */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  SettingsFileRawSchema,
  type SettingsFileRaw,
} from './settings-schema';

export interface SettingsStore {
  read(): unknown;
  write(next: Readonly<Record<string, unknown>>): void;
}

export interface CreateSettingsStoreRequest {
  readonly settingsPath: string;
}

export class SettingsStoreParseError extends Error {
  readonly code = 'settings_store_parse_error';
  readonly settingsPath: string;

  constructor(settingsPath: string) {
    super('Megumi settings could not be parsed.');
    this.name = 'SettingsStoreParseError';
    this.settingsPath = settingsPath;
  }
}

export function createSettingsStore(request: CreateSettingsStoreRequest): SettingsStore {
  const settingsPath = path.resolve(request.settingsPath);
  return {
    read: () => readSettingsFile(settingsPath),
    write: (next) => writeSettingsFile(settingsPath, next),
  };
}

function readSettingsFile(settingsPath: string): SettingsFileRaw {
  const text = readFileIfExists(settingsPath);
  if (text === undefined || text.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    const compatible = normalizeLegacyProviderApis(
      normalizeLegacyProviderModels(withoutObsoleteCompaction(parsed)),
    );
    const current = SettingsFileRawSchema.safeParse(compatible);
    if (current.success) return current.data;
    return SettingsFileRawSchema.parse(appRawToSettingsFileRaw(AppSettingsRawSchema.parse(compatible)));
  } catch {
    throw new SettingsStoreParseError(settingsPath);
  }
}

function writeSettingsFile(
  settingsPath: string,
  next: Readonly<Record<string, unknown>>,
): void {
  const parsed = SettingsFileRawSchema.parse(next);
  writeFileAtomic(settingsPath, `${JSON.stringify(parsed, null, 2)}\n`);
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

function readFileIfExists(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

function writeFileAtomic(filePath: string, content: string): void {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(directory, `${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fs.mkdirSync(directory, { recursive: true });
  try {
    fs.writeFileSync(temporaryPath, content, 'utf8');
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {
      // Preserve the original atomic-write failure.
    }
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
