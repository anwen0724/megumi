/* Owns settings.json file IO and atomic local file replacement. */
import fs from 'node:fs';
import path from 'node:path';
import { ConfigurationFileSchema, ConfigurationSchema, GlobalOnlySettingsFields } from './settings-schema';
import type { ReadSettingsResult, SettingsSnapshot, SettingsScope } from './settings-contracts';
import { readJsonFile } from './json-file';
import { publicRawFromFile, resolvePublicSettings } from './settings-file-model';
import { settingsLoadIssues, type SettingsLoadIssue } from './settings-failure-factory';
import {
  SettingsFileRawSchema,
  type SettingsFileRaw,
} from './settings-schema';
import {
  isLegacyAppSettings,
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
  readonly issues: SettingsLoadIssue[];

  constructor(settingsPath: string, issues: SettingsLoadIssue[] = settingsLoadIssues(undefined)) {
    super('Megumi settings could not be parsed.');
    this.name = 'SettingsStoreParseError';
    this.settingsPath = settingsPath;
    this.issues = issues;
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
  if (text === undefined) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    // Legacy AppSettings files keep the protocol field and camelCase keys:
    // detect them before tolerant parsing accepts them as current format.
    if (isLegacyAppSettings(parsed)) {
      return SettingsFileRawSchema.parse(legacyAppSettingsToFileRaw(parsed));
    }
    const normalized = normalizeSettingsFile(parsed);
    const current = SettingsFileRawSchema.safeParse(normalized.value);
    if (current.success) {
      // Migrated files are written back once so the disk format stays current.
      if (normalized.changed) {
        // Never persist a conversion if the resulting runtime configuration is invalid.
        resolvePublicSettings(publicRawFromFile(current.data));
        writeSettingsFile(settingsPath, current.data);
      }
      return current.data;
    }
    return SettingsFileRawSchema.parse(normalized.value);
  } catch (error) {
    throw new SettingsStoreParseError(settingsPath, settingsLoadIssues(error));
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

export interface CreateSettingsOptions {
  globalSettingsPath: string;
  projectSettingsPath?: string;
  credentialsPath: string;
  readEnvironment: (name: string) => string | undefined;
}

/** Creates file-bound configuration access without creating any files. */
export function createSettings(options: CreateSettingsOptions) {
  return {
    /** Reads and validates the latest complete configuration; never writes files. */
    readSettings(): ReadSettingsResult {
      const global = readJsonFile(options.globalSettingsPath);
      const project = options.projectSettingsPath
        ? readJsonFile(options.projectSettingsPath)
        : { status: 'ok' as const, document: {} };
      if (global.status === 'invalid' || project.status === 'invalid') {
        return invalidConfiguration([{ path: [], message: 'Settings must contain a JSON object.' }],
          global.status === 'invalid' ? 'global' : 'project');
      }
      const scopeIssues = Object.entries(GlobalOnlySettingsFields).flatMap(([group, fields]) => {
        const values = project.document[group];
        return isConfigurationObject(values)
          ? fields.filter((field) => Object.hasOwn(values, field)).map((field) => ({
            scope: 'project' as const,
            path: [group, field],
            message: 'This setting can only be saved globally.',
          }))
          : [];
      });
      if (scopeIssues.length > 0) {
        return { status: 'rejected', error: {
          code: 'SETTINGS_SCOPE_INVALID',
          message: 'Project settings contain global-only fields.',
          issues: scopeIssues,
        } };
      }
      const globalValues = ConfigurationFileSchema.safeParse(global.document);
      const projectValues = ConfigurationFileSchema.safeParse(project.document);
      if (!globalValues.success) return invalidConfiguration(globalValues.error.issues, 'global');
      if (!projectValues.success) return invalidConfiguration(projectValues.error.issues, 'project');
      const combined = ConfigurationSchema.safeParse(mergeConfiguration(globalValues.data, projectValues.data));
      if (!combined.success) {
        return invalidConfiguration(combined.error.issues);
      }
      return {
        status: 'ok',
        settings: {
          config: combined.data,
          sources: configurationSources(combined.data, globalValues.data, projectValues.data),
          revision: '',
          diagnostics: [
            ...unknownConfigurationFields(global.document, globalValues.data, 'global'),
            ...unknownConfigurationFields(project.document, projectValues.data, 'project'),
          ],
        },
      };
    },
  };
}

/** Converts validation issues without exposing raw files or secret-bearing unknown fields. */
function invalidConfiguration(
  issues: readonly { path: readonly (string | number)[]; message: string }[],
  scope?: SettingsScope,
): Extract<ReadSettingsResult, { status: 'rejected' }> {
  return {
    status: 'rejected',
    error: {
      code: 'SETTINGS_INVALID',
      message: 'Settings contain invalid configuration.',
      issues: issues.map((issue) => ({
        ...(scope ? { scope } : {}),
        path: issue.path.map(String),
        message: issue.message,
      })),
    },
  };
}

/** Merges object fields while arrays and model references replace complete values. */
function mergeConfiguration(
  lower: Record<string, unknown>,
  higher: Record<string, unknown>,
  fieldPath: readonly string[] = [],
): Record<string, unknown> {
  return Object.fromEntries([...new Set([...Object.keys(lower), ...Object.keys(higher)])].map((key) => {
    const nextPath = [...fieldPath, key];
    const before = lower[key];
    const after = higher[key];
    return [key, after === undefined ? before
      : isConfigurationObject(before) && isConfigurationObject(after) && !isModelReferencePath(nextPath)
        ? mergeConfiguration(before, after, nextPath)
        : after];
  }));
}

/** Attributes effective value fields without returning unknown file contents. */
function configurationSources(
  config: Record<string, unknown>,
  global: Record<string, unknown>,
  project: Record<string, unknown>,
  fieldPath: readonly string[] = [],
): SettingsSnapshot['sources'] {
  return Object.entries(config).flatMap(([name, value]) => {
    const nextPath = [...fieldPath, name];
    const globalValue = global[name];
    const projectValue = project[name];
    if (isConfigurationObject(value) && !isModelReferencePath(nextPath)) {
      return configurationSources(
        value,
        isConfigurationObject(globalValue) ? globalValue : {},
        isConfigurationObject(projectValue) ? projectValue : {},
        nextPath,
      );
    }
    return [{ path: nextPath, source: projectValue !== undefined ? 'project' as const
      : globalValue !== undefined ? 'global' as const : 'default' as const }];
  });
}

function isModelReferencePath(fieldPath: readonly string[]): boolean {
  return fieldPath.length === 2 && fieldPath[0] === 'models' && fieldPath[1] === 'defaultModel';
}

function isConfigurationObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Reports discarded field locations, never their potentially secret contents. */
function unknownConfigurationFields(
  document: Record<string, unknown>,
  known: Record<string, unknown>,
  scope: SettingsScope,
  fieldPath: readonly string[] = [],
): SettingsSnapshot['diagnostics'] {
  return Object.entries(document).flatMap(([name, value]) => {
    const nextPath = [...fieldPath, name];
    if (!Object.hasOwn(known, name)) {
      return [{ code: 'SETTINGS_UNKNOWN_FIELD' as const, scope, path: nextPath, message: 'This field is not declared.' }];
    }
    const knownValue = known[name];
    return isConfigurationObject(value) && isConfigurationObject(knownValue)
      ? unknownConfigurationFields(value, knownValue, scope, nextPath)
      : [];
  });
}
