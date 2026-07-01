// Provides local settings.json persistence for the shell-agnostic Coding Agent product.
import fs from 'node:fs';
import path from 'node:path';
import { AppSettingsRawSchema, type AppSettingsRaw } from '@megumi/coding-agent/settings';
import type { ProductSettingsStoragePort } from '../../../settings';

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
): ProductSettingsStoragePort {
  const settingsPath = path.resolve(options.settingsPath);

  return {
    readRawSettings: () => readRawSettings(settingsPath),
    writeRawSettings: (next) => writeRawSettings(settingsPath, next),
  };
}

function readRawSettings(settingsPath: string): AppSettingsRaw {
  const text = readFileIfExistsSync(settingsPath);
  if (!text) {
    return {};
  }

  try {
    return AppSettingsRawSchema.parse(JSON.parse(text));
  } catch (error) {
    throw new LocalSettingsJsonParseError(
      `Megumi settings could not be parsed: ${error instanceof Error ? error.message : 'Unknown error.'}`,
      settingsPath,
    );
  }
}

function writeRawSettings(settingsPath: string, next: AppSettingsRaw): void {
  const parsed = AppSettingsRawSchema.parse(next);
  writeFileAtomicSync(settingsPath, `${JSON.stringify(parsed, null, 2)}\n`);
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

