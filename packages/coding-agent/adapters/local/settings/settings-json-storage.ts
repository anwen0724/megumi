// Provides local settings.json persistence for the shell-agnostic Coding Agent product.
import fs from 'node:fs';
import path from 'node:path';
import {
  AppSettingsRawSchema,
  SettingsRawSchema,
  type AppSettingsRaw,
  type SettingsFileStore,
  type SettingsRaw,
} from '@megumi/coding-agent/settings';

export interface LocalSettingsJsonStorageOptions {
  settingsPath: string;
}

export class LocalSettingsJsonParseError extends Error {
  readonly code = 'local_settings_json_parse_error';

  constructor(message: string, readonly settingsPath: string) {
    super(message);
    this.name = 'LocalSettingsJsonParseError';
  }
}

export function createLocalSettingsJsonStorage(
  options: LocalSettingsJsonStorageOptions,
): SettingsFileStore {
  const settingsPath = path.resolve(options.settingsPath);

  return {
    readRawSettings: () => readRawSettings(settingsPath),
    writeRawSettings: (next) => writeRawSettings(settingsPath, next),
  };
}

function readRawSettings(settingsPath: string): SettingsRaw {
  const text = readFileIfExistsSync(settingsPath);
  if (!text) {
    return {};
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    const target = SettingsRawSchema.safeParse(parsed);
    if (target.success) {
      return target.data;
    }
    return appRawToSettingsRaw(AppSettingsRawSchema.parse(parsed));
  } catch (error) {
    throw new LocalSettingsJsonParseError(
      `Megumi settings could not be parsed: ${error instanceof Error ? error.message : 'Unknown error.'}`,
      settingsPath,
    );
  }
}

function writeRawSettings(settingsPath: string, next: SettingsRaw): void {
  const parsed = SettingsRawSchema.parse(next);
  writeFileAtomicSync(settingsPath, `${JSON.stringify(parsed, null, 2)}\n`);
}

function appRawToSettingsRaw(raw: AppSettingsRaw): SettingsRaw {
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
    ...(raw.compaction ? {
      compaction: {
        ...(raw.compaction.enabled !== undefined ? { enabled: raw.compaction.enabled } : {}),
        ...(raw.compaction.reserveTokens !== undefined ? { reserve_tokens: raw.compaction.reserveTokens } : {}),
        ...(raw.compaction.keepRecentTokens !== undefined ? { keep_recent_tokens: raw.compaction.keepRecentTokens } : {}),
      },
    } : {}),
    ...(raw.providers ? {
      providers: Object.fromEntries(Object.entries(raw.providers).map(([providerId, provider]) => [
        providerId,
        {
          ...(provider.enabled !== undefined ? { enabled: provider.enabled } : {}),
          ...(provider.kind ? { kind: provider.kind } : {}),
          ...(provider.displayName ? { display_name: provider.displayName } : {}),
          ...(provider.baseUrl ? { base_url: provider.baseUrl } : {}),
          ...(provider.defaultModel ? { models: [provider.defaultModel] } : {}),
          ...(provider.apiKey !== undefined ? { api_key: provider.apiKey } : {}),
          ...(provider.apiKeyEnv !== undefined ? { api_key_env: provider.apiKeyEnv } : {}),
        },
      ])),
    } : {}),
  };
}

function readFileIfExistsSync(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

function writeFileAtomicSync(filePath: string, content: string): void {
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
      // Preserve the original write error; temp cleanup is best effort.
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
