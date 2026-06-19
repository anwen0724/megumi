// Owns the desktop settings.json file and resolves sparse user settings with defaults.
import fs from 'node:fs';
import path from 'node:path';

export type AppThemeName = 'megumi-warm' | 'neutral-light' | 'graphite-dark' | 'sage-mist' | 'midnight-blue';
export type ProviderId = 'deepseek' | 'openai' | 'anthropic';
export type ProviderKind = 'openai-compatible' | 'anthropic';

export interface ProviderSettingsRaw {
  enabled?: boolean;
  kind?: ProviderKind;
  displayName?: string;
  baseUrl?: string;
  defaultModel?: string;
  apiKey?: string | null;
  apiKeyEnv?: string | null;
}

export interface AppSettingsRaw {
  theme?: AppThemeName;
  memory?: { enabled?: boolean };
  compaction?: { enabled?: boolean; reserveTokens?: number; keepRecentTokens?: number };
  chat?: { defaultProvider?: ProviderId };
  providers?: Partial<Record<ProviderId, ProviderSettingsRaw>>;
  permissions?: Record<string, unknown>;
}

export interface ProviderSettingsResolved {
  enabled: boolean;
  kind: ProviderKind;
  displayName: string;
  baseUrl?: string;
  defaultModel: string;
  apiKey?: string;
  apiKeyEnv?: string;
}

export interface AppSettingsResolved {
  theme: AppThemeName;
  memory: { enabled: boolean };
  compaction: { enabled: boolean; reserveTokens: number; keepRecentTokens: number };
  chat: { defaultProvider: ProviderId };
  providers: Record<ProviderId, ProviderSettingsResolved>;
  permissions: Record<string, unknown>;
}

export interface AppSettingsStore {
  getRawSettings(): AppSettingsRaw;
  getResolvedSettings(): AppSettingsResolved;
  updateSettings(patch: AppSettingsRaw): AppSettingsResolved;
}

export interface CreateAppSettingsStoreOptions {
  settingsPath: string;
}

export const DEFAULT_APP_SETTINGS: AppSettingsResolved = {
  theme: 'midnight-blue',
  memory: { enabled: false },
  compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
  chat: { defaultProvider: 'deepseek' },
  providers: {
    deepseek: {
      enabled: true,
      kind: 'openai-compatible',
      displayName: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      defaultModel: 'deepseek-v4-flash',
      apiKeyEnv: 'DEEPSEEK_API_KEY',
    },
    openai: {
      enabled: true,
      kind: 'openai-compatible',
      displayName: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      defaultModel: 'gpt-5.5',
      apiKeyEnv: 'OPENAI_API_KEY',
    },
    anthropic: {
      enabled: false,
      kind: 'anthropic',
      displayName: 'Anthropic',
      defaultModel: 'claude-sonnet-4-6',
      apiKeyEnv: 'ANTHROPIC_API_KEY',
    },
  },
  permissions: {},
};

export function createAppSettingsStore(options: CreateAppSettingsStoreOptions): AppSettingsStore {
  const settingsPath = path.resolve(options.settingsPath);
  return {
    getRawSettings() {
      return readRawSettings(settingsPath);
    },
    getResolvedSettings() {
      return resolveAppSettings(readRawSettings(settingsPath));
    },
    updateSettings(patch) {
      const next = mergeRawAppSettings(readRawSettings(settingsPath), patch);
      writeRawSettings(settingsPath, next);
      return resolveAppSettings(next);
    },
  };
}

export function resolveAppSettings(raw: AppSettingsRaw = {}): AppSettingsResolved {
  return {
    ...DEFAULT_APP_SETTINGS,
    ...defined({
      theme: raw.theme,
      memory: raw.memory ? { ...DEFAULT_APP_SETTINGS.memory, ...defined(raw.memory) } : undefined,
      compaction: raw.compaction ? { ...DEFAULT_APP_SETTINGS.compaction, ...defined(raw.compaction) } : undefined,
      chat: raw.chat ? { ...DEFAULT_APP_SETTINGS.chat, ...defined(raw.chat) } : undefined,
      providers: raw.providers ? resolveProviders(raw.providers) : undefined,
      permissions: raw.permissions ? { ...raw.permissions } : undefined,
    }),
  };
}

export function mergeRawAppSettings(current: AppSettingsRaw, patch: AppSettingsRaw): AppSettingsRaw {
  return {
    ...current,
    ...defined({
      theme: patch.theme,
      memory: patch.memory ? { ...(current.memory ?? {}), ...defined(patch.memory) } : undefined,
      compaction: patch.compaction ? { ...(current.compaction ?? {}), ...defined(patch.compaction) } : undefined,
      chat: patch.chat ? { ...(current.chat ?? {}), ...defined(patch.chat) } : undefined,
      providers: patch.providers ? mergeProviders(current.providers ?? {}, patch.providers) : undefined,
      permissions: patch.permissions ? { ...(current.permissions ?? {}), ...defined(patch.permissions) } : undefined,
    }),
  };
}

function resolveProviders(raw: NonNullable<AppSettingsRaw['providers']>): Record<ProviderId, ProviderSettingsResolved> {
  return {
    deepseek: resolveProvider('deepseek', raw.deepseek),
    openai: resolveProvider('openai', raw.openai),
    anthropic: resolveProvider('anthropic', raw.anthropic),
  };
}

function resolveProvider(providerId: ProviderId, raw?: ProviderSettingsRaw): ProviderSettingsResolved {
  const base = DEFAULT_APP_SETTINGS.providers[providerId];
  const merged = { ...base, ...defined(raw ?? {}) };
  if (raw?.apiKey === null) delete merged.apiKey;
  if (raw?.apiKeyEnv === null) delete merged.apiKeyEnv;
  return merged;
}

function mergeProviders(
  current: NonNullable<AppSettingsRaw['providers']>,
  patch: NonNullable<AppSettingsRaw['providers']>,
): NonNullable<AppSettingsRaw['providers']> {
  const next: NonNullable<AppSettingsRaw['providers']> = { ...current };
  for (const providerId of ['deepseek', 'openai', 'anthropic'] as const) {
    if (!patch[providerId]) continue;
    const merged: ProviderSettingsRaw = { ...(current[providerId] ?? {}), ...defined(patch[providerId] ?? {}) };
    if (patch[providerId]?.apiKey === null) delete merged.apiKey;
    if (patch[providerId]?.apiKeyEnv === null) delete merged.apiKeyEnv;
    next[providerId] = merged;
  }
  return next;
}

function readRawSettings(settingsPath: string): AppSettingsRaw {
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as AppSettingsRaw;
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

function writeRawSettings(settingsPath: string, raw: AppSettingsRaw): void {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  const temporaryPath = path.join(path.dirname(settingsPath), `${path.basename(settingsPath)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temporaryPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, settingsPath);
}

function defined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}
