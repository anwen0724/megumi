// Initializes the desktop-owned Megumi home directory without defining database schema.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppSettingsJsonSchema } from '@megumi/shared/settings';

export const MEGUMI_HOME_VERSION = 1;
export const MEGUMI_HOME_MIGRATION_ID = 'megumi-home-v1';

export interface MegumiHomeEnv {
  MEGUMI_HOME?: string;
}

export interface MegumiHomePaths {
  homePath: string;
  settingsPath: string;
  settingsSchemaPath: string;
  readmePath: string;
  versionPath: string;
  sqlitePath: string;
  databasePath: string;
  logsPath: string;
  runtimeLogPath: string;
  cachePath: string;
  tmpPath: string;
}

export interface ResolveMegumiHomePathOptions {
  env?: MegumiHomeEnv;
  homeDirectory?: string;
}

export interface InitializeMegumiHomeOptions extends ResolveMegumiHomePathOptions {
  now?: () => Date;
}

export function resolveMegumiHomePath(options: ResolveMegumiHomePathOptions = {}): string {
  const override = options.env?.MEGUMI_HOME?.trim();
  return path.resolve(override || path.join(options.homeDirectory ?? os.homedir(), '.megumi'));
}

export function buildMegumiHomePaths(homePath: string): MegumiHomePaths {
  const resolved = path.resolve(homePath);
  const sqlitePath = path.join(resolved, 'sqlite');
  const logsPath = path.join(resolved, 'logs');
  return {
    homePath: resolved,
    settingsPath: path.join(resolved, 'settings.json'),
    settingsSchemaPath: path.join(resolved, 'settings.schema.json'),
    readmePath: path.join(resolved, 'README.md'),
    versionPath: path.join(resolved, 'version.json'),
    sqlitePath,
    databasePath: path.join(sqlitePath, 'megumi.sqlite3'),
    logsPath,
    runtimeLogPath: path.join(logsPath, 'runtime.jsonl'),
    cachePath: path.join(resolved, 'cache'),
    tmpPath: path.join(resolved, 'tmp'),
  };
}

export function initializeMegumiHome(options: InitializeMegumiHomeOptions = {}): MegumiHomePaths {
  const now = options.now ?? (() => new Date());
  const paths = buildMegumiHomePaths(resolveMegumiHomePath(options));

  for (const directory of [paths.homePath, paths.sqlitePath, paths.logsPath, paths.cachePath, paths.tmpPath]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  writeManagedSettingsSchema(paths.settingsSchemaPath, createAppSettingsJsonSchema());
  writeJsonIfMissing(paths.versionPath, {
    version: MEGUMI_HOME_VERSION,
    createdAt: now().toISOString(),
    lastMigration: MEGUMI_HOME_MIGRATION_ID,
  });
  writeTextIfMissing(paths.readmePath, createMegumiHomeReadme());
  return paths;
}

function writeJsonIfMissing(filePath: string, data: unknown): void {
  if (fs.existsSync(filePath)) return;
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function writeManagedSettingsSchema(filePath: string, data: Record<string, unknown>): void {
  if (settingsSchemaIsCurrent(filePath)) return;
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function settingsSchemaIsCurrent(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  try {
    const current = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    return current.title === 'Megumi settings'
      && current.additionalProperties === false
      && isRecord(current.properties)
      && isRecord(current.properties.providers)
      && isRecord(current.properties.memory)
      && isRecord(current.properties.permissions);
  } catch {
    return false;
  }
}

function writeTextIfMissing(filePath: string, data: string): void {
  if (fs.existsSync(filePath)) return;
  fs.writeFileSync(filePath, data, 'utf8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function createMegumiHomeReadme(): string {
  return [
    '# Megumi Home',
    '',
    'This directory stores Megumi runtime configuration and local agent data.',
    '',
    'Safe to edit:',
    '',
    '- `settings.json` for app preferences and provider configuration.',
    '',
    'Managed by Megumi:',
    '',
    '- `settings.schema.json` for editor validation.',
    '- `version.json` for home directory metadata.',
    '- `sqlite/` for structured runtime state.',
    '- `logs/` for runtime JSONL logs.',
    '- `cache/` for regenerable cache data.',
    '- `tmp/` for temporary files.',
    '',
  ].join('\n');
}
