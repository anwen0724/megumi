// Owns the user-editable Megumi settings.json file for Desktop Main.
// It reads sparse raw settings from disk and exposes resolved settings with defaults applied.
import path from 'node:path';
import fs from 'node:fs';
import {
  AppSettingsRawSchema,
  mergeRawAppSettings,
  resolveAppSettings,
  type AppSettingsRaw,
  type AppSettingsResolved,
} from '@megumi/shared/settings';

export interface AppSettingsFileSystem {
  readText(filePath: string): string | undefined | Promise<string | undefined>;
  writeTextAtomic(filePath: string, content: string): void | Promise<void>;
}

export interface AppSettingsServiceOptions {
  settingsPath: string;
  fileSystem?: AppSettingsFileSystem;
}

export interface AppSettingsService {
  getRawSettings(): AppSettingsRaw;
  getResolvedSettings(): AppSettingsResolved;
  updateSettings(patch: AppSettingsRaw): AppSettingsResolved;
}

export class AppSettingsParseError extends Error {
  readonly code = 'app_settings_parse_error';

  constructor(message: string, readonly settingsPath: string) {
    super(message);
    this.name = 'AppSettingsParseError';
  }
}

export function createAppSettingsService(options: AppSettingsServiceOptions): AppSettingsService {
  const settingsPath = path.resolve(options.settingsPath);
  const fileSystem = options.fileSystem ?? createNodeAppSettingsFileSystem();

  function readRawSettings(): AppSettingsRaw {
    const text = fileSystem.readText(settingsPath);
    if (isPromiseLike(text)) {
      throw new Error('Async app settings filesystem is not supported by the sync settings service.');
    }
    if (!text) {
      return {};
    }
    try {
      return AppSettingsRawSchema.parse(JSON.parse(text));
    } catch (error) {
      throw new AppSettingsParseError(
        `Megumi settings could not be parsed: ${error instanceof Error ? error.message : 'Unknown error.'}`,
        settingsPath,
      );
    }
  }

  function writeRawSettings(raw: AppSettingsRaw): void {
    const parsed = AppSettingsRawSchema.parse(raw);
    const result = fileSystem.writeTextAtomic(settingsPath, `${JSON.stringify(parsed, null, 2)}\n`);
    if (isPromiseLike(result)) {
      throw new Error('Async app settings filesystem is not supported by the sync settings service.');
    }
  }

  return {
    getRawSettings: () => readRawSettings(),
    getResolvedSettings: () => resolveAppSettings(readRawSettings()),
    updateSettings(patch) {
      const nextRaw = mergeRawAppSettings(readRawSettings(), patch);
      writeRawSettings(nextRaw);
      return resolveAppSettings(nextRaw);
    },
  };
}

function createNodeAppSettingsFileSystem(): AppSettingsFileSystem {
  return {
    readText(filePath) {
      return readFileIfExistsSync(filePath);
    },
    writeTextAtomic(filePath, content) {
      writeFileAtomicSync(filePath, content);
    },
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
      // Best-effort cleanup; preserve the original write error.
    }
    throw error;
  }
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof value === 'object' && value !== null && 'then' in value;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
