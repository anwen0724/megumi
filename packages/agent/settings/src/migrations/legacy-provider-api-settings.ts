/*
 * Performs the one-time Settings-owned migration from legacy Provider protocol
 * settings to the current API field before strict Agent Settings parsing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { SettingsRawSchema } from '../settings-schema';

const LEGACY_PROVIDER_API = {
  'openai-compatible': 'openai-completions',
  anthropic: 'anthropic-messages',
} as const;

export function migrateLegacyProviderApiSettingsFile(settingsPath: string): void {
  const absolutePath = path.resolve(settingsPath);
  let text: string;
  try {
    text = fs.readFileSync(absolutePath, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return;
    throw error;
  }

  const parsed = JSON.parse(text) as unknown;
  const result = migrateLegacyProviderApiSettings(parsed);
  if (!result.migrated) return;
  writeAtomic(absolutePath, `${JSON.stringify(result.settings, null, 2)}\n`);
}

export function migrateLegacyProviderApiSettings(value: unknown): {
  migrated: boolean;
  settings: unknown;
} {
  if (!isRecord(value) || !isRecord(value.providers)) {
    return { migrated: false, settings: value };
  }

  let migrated = false;
  const providers = Object.fromEntries(Object.entries(value.providers).map(([providerId, candidate]) => {
    if (!isRecord(candidate) || !('protocol' in candidate)) return [providerId, candidate];

    const mappedApi = legacyProviderApi(candidate.protocol);
    if (!mappedApi && !('api' in candidate)) return [providerId, candidate];

    const { protocol: _legacyProtocol, ...provider } = candidate;
    migrated = true;
    return [providerId, {
      ...provider,
      ...(!('api' in provider) && mappedApi ? { api: mappedApi } : {}),
    }];
  }));

  if (!migrated) return { migrated: false, settings: value };

  const candidate = { ...value, providers };
  const parsed = SettingsRawSchema.safeParse(publicSettingsView(candidate));
  if (!parsed.success) {
    // Another legacy format may still be handled by the Settings storage
    // adapter. Never rewrite a file that is not valid in the current format.
    return { migrated: false, settings: value };
  }
  return { migrated: true, settings: candidate };
}

function publicSettingsView(value: Record<string, unknown>): Record<string, unknown> {
  const providers = isRecord(value.providers)
    ? Object.fromEntries(Object.entries(value.providers).map(([providerId, candidate]) => {
        if (!isRecord(candidate)) return [providerId, candidate];
        const { api_key: _secret, ...provider } = candidate;
        return [providerId, provider];
      }))
    : value.providers;
  const web = isRecord(value.web) && isRecord(value.web.search)
    ? {
        ...value.web,
        search: (({ api_key: _secret, ...search }) => search)(value.web.search),
      }
    : value.web;
  return {
    ...value,
    ...(providers !== undefined ? { providers } : {}),
    ...(web !== undefined ? { web } : {}),
  };
}

function legacyProviderApi(value: unknown): string | undefined {
  return typeof value === 'string'
    ? LEGACY_PROVIDER_API[value as keyof typeof LEGACY_PROVIDER_API]
    : undefined;
}

function writeAtomic(filePath: string, content: string): void {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, content, 'utf8');
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    try { fs.rmSync(temporaryPath, { force: true }); } catch { /* Preserve the original write error. */ }
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
