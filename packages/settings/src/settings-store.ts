/* Owns settings.json file IO and atomic local file replacement. */
import fs from 'node:fs';
import path from 'node:path';
import {
  SettingsFileRawSchema,
  type SettingsFileRaw,
} from './settings-schema';
import {
  legacyAppSettingsToFileRaw,
  normalizeSettingsFile,
} from './settings-migration';

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
    const normalized = normalizeSettingsFile(parsed);
    const current = SettingsFileRawSchema.safeParse(normalized.value);
    if (current.success) {
      // Migrated files are written back once so the disk format stays current.
      if (normalized.changed) writeSettingsFile(settingsPath, current.data);
      return current.data;
    }
    // Legacy AppSettings files keep the protocol field: normalize the raw
    // value only after deciding they are not current-format files.
    return SettingsFileRawSchema.parse(legacyAppSettingsToFileRaw(parsed));
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
