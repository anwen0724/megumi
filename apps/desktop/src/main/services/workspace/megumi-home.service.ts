// Owns Megumi Home path resolution and minimal directory initialization for Desktop Main.
// User-editable configuration lives in sparse settings.json; defaults stay in code.
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

export const MEGUMI_HOME_VERSION = 1;
export const MEGUMI_HOME_MIGRATION_ID = 'megumi-home-v1';

export interface MegumiHomeEnv {
  MEGUMI_HOME?: string;
}

export interface MegumiHomeClock {
  now(): Date;
}

export interface MegumiHomeFileSystem {
  ensureDir(directoryPath: string): Promise<void>;
  pathExists(filePath: string): Promise<boolean>;
  writeJson(filePath: string, data: unknown, options?: { spaces?: number }): Promise<void>;
  writeFile(filePath: string, data: string): Promise<void>;
}

export interface MegumiHomeSyncFileSystem {
  ensureDirSync(directoryPath: string): void;
  pathExistsSync(filePath: string): boolean;
  writeJsonSync(filePath: string, data: unknown, options?: { spaces?: number }): void;
  writeFileSync(filePath: string, data: string): void;
}

export interface MegumiHomeVersion {
  version: number;
  createdAt: string;
  lastMigration: string;
}

export interface MegumiHomePaths {
  homePath: string;
  settingsPath: string;
  settingsSchemaPath: string;
  readmePath: string;
  versionPath: string;
  sqlitePath: string;
  logsPath: string;
  cachePath: string;
  tmpPath: string;
}

export interface ResolveMegumiHomePathOptions {
  env: MegumiHomeEnv;
  homeDirectory: string;
}

export interface InitializeMegumiHomeOptions extends ResolveMegumiHomePathOptions {
  fileSystem: MegumiHomeFileSystem;
  clock: MegumiHomeClock;
}

export interface InitializeMegumiHomeSyncOptions extends ResolveMegumiHomePathOptions {
  fileSystem: MegumiHomeSyncFileSystem;
  clock: MegumiHomeClock;
}

export function resolveMegumiHomePath(options: ResolveMegumiHomePathOptions): string {
  const override = options.env.MEGUMI_HOME?.trim();

  if (override) {
    return path.resolve(override);
  }

  return path.resolve(options.homeDirectory, '.megumi');
}

export function buildMegumiHomePaths(homePath: string): MegumiHomePaths {
  const resolvedHomePath = path.resolve(homePath);

  return {
    homePath: resolvedHomePath,
    settingsPath: path.join(resolvedHomePath, 'settings.json'),
    settingsSchemaPath: path.join(resolvedHomePath, 'settings.schema.json'),
    readmePath: path.join(resolvedHomePath, 'README.md'),
    versionPath: path.join(resolvedHomePath, 'version.json'),
    sqlitePath: path.join(resolvedHomePath, 'sqlite'),
    logsPath: path.join(resolvedHomePath, 'logs'),
    cachePath: path.join(resolvedHomePath, 'cache'),
    tmpPath: path.join(resolvedHomePath, 'tmp'),
  };
}

export async function initializeMegumiHome(options: InitializeMegumiHomeOptions): Promise<MegumiHomePaths> {
  const paths = buildMegumiHomePaths(resolveMegumiHomePath(options));

  await ensureMinimalDirectories(options.fileSystem, paths);
  await writeJsonIfMissing(options.fileSystem, paths.settingsSchemaPath, createMegumiSettingsSchema());
  await writeJsonIfMissing(options.fileSystem, paths.versionPath, createMegumiHomeVersion(options.clock.now()));
  await writeTextIfMissing(options.fileSystem, paths.readmePath, createMegumiHomeReadme());

  return paths;
}

export async function initializeElectronMegumiHome(): Promise<MegumiHomePaths> {
  return initializeMegumiHome({
    env: process.env,
    homeDirectory: os.homedir(),
    fileSystem: fs,
    clock: {
      now: () => new Date(),
    },
  });
}

export function initializeMegumiHomeSync(options: InitializeMegumiHomeSyncOptions): MegumiHomePaths {
  const paths = buildMegumiHomePaths(resolveMegumiHomePath(options));

  ensureMinimalDirectoriesSync(options.fileSystem, paths);
  writeJsonIfMissingSync(options.fileSystem, paths.settingsSchemaPath, createMegumiSettingsSchema());
  writeJsonIfMissingSync(options.fileSystem, paths.versionPath, createMegumiHomeVersion(options.clock.now()));
  writeTextIfMissingSync(options.fileSystem, paths.readmePath, createMegumiHomeReadme());

  return paths;
}

export function initializeElectronMegumiHomeSync(): MegumiHomePaths {
  return initializeMegumiHomeSync({
    env: process.env,
    homeDirectory: os.homedir(),
    fileSystem: fs,
    clock: {
      now: () => new Date(),
    },
  });
}

export function createMegumiHomeVersion(createdAt: Date): MegumiHomeVersion {
  return {
    version: MEGUMI_HOME_VERSION,
    createdAt: createdAt.toISOString(),
    lastMigration: MEGUMI_HOME_MIGRATION_ID,
  };
}

export function createMegumiSettingsSchema(): Record<string, unknown> {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Megumi settings',
    type: 'object',
    additionalProperties: false,
    properties: {
      language: { enum: ['zh-CN', 'en-US'] },
      theme: { type: 'string' },
      setup: {
        type: 'object',
        additionalProperties: false,
        properties: {
          completed: { type: 'boolean' },
          completedAt: { type: 'string' },
        },
      },
      memory: {
        type: 'object',
        additionalProperties: false,
        properties: {
          enabled: { type: 'boolean' },
        },
      },
      compaction: {
        type: 'object',
        additionalProperties: false,
        properties: {
          enabled: { type: 'boolean' },
          reserveTokens: { type: 'integer', minimum: 1 },
          keepRecentTokens: { type: 'integer', minimum: 1 },
        },
      },
      providers: {
        type: 'object',
        additionalProperties: false,
        properties: {
          deepseek: providerSettingsSchema(),
          openai: providerSettingsSchema(),
          anthropic: providerSettingsSchema(),
          custom: providerSettingsSchema(),
        },
      },
      permissions: {
        type: 'object',
        additionalProperties: false,
        properties: {
          allow: permissionRuleListSchema(),
          ask: permissionRuleListSchema(),
          deny: permissionRuleListSchema(),
        },
      },
    },
  };
}

export function createMegumiHomeReadme(): string {
  return [
    '# Megumi Home',
    '',
    'This directory stores Megumi runtime configuration and local agent data.',
    '',
    'Safe to edit:',
    '',
    '- `settings.json` for app preferences, provider configuration, model defaults, permissions, and intentional plaintext API keys.',
    '- `language` and `setup` fields in `settings.json` store the first-run setup status and language preference.',
    '',
    'Managed by Megumi:',
    '',
    '- `settings.schema.json` for editor validation.',
    '- `version.json` for home directory metadata.',
    '- `sqlite/` for structured runtime state.',
    '- `logs/` for application logs.',
    '- `cache/` for regenerable cache data.',
    '- `tmp/` for temporary files.',
    '',
    'Credential priority:',
    '',
    '1. Plaintext `apiKey` in `settings.json` when intentionally provided.',
    '2. Environment variable configured by `apiKeyEnv`.',
    '',
    'Set `MEGUMI_HOME` to use a different Megumi Home directory.',
    '',
  ].join('\n');
}

function providerSettingsSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: { type: 'boolean' },
      kind: { enum: ['openai-compatible', 'anthropic'] },
      displayName: { type: 'string' },
      baseUrl: { type: 'string' },
      defaultModel: { type: 'string' },
      apiKey: { type: 'string' },
      apiKeyEnv: { type: 'string' },
    },
  };
}

function permissionRuleListSchema(): Record<string, unknown> {
  return {
    type: 'array',
    items: {
      type: 'string',
    },
  };
}

async function ensureMinimalDirectories(fileSystem: MegumiHomeFileSystem, paths: MegumiHomePaths): Promise<void> {
  for (const directoryPath of [
    paths.homePath,
    paths.sqlitePath,
    paths.logsPath,
    paths.cachePath,
    paths.tmpPath,
  ]) {
    await fileSystem.ensureDir(directoryPath);
  }
}

function ensureMinimalDirectoriesSync(fileSystem: MegumiHomeSyncFileSystem, paths: MegumiHomePaths): void {
  for (const directoryPath of [
    paths.homePath,
    paths.sqlitePath,
    paths.logsPath,
    paths.cachePath,
    paths.tmpPath,
  ]) {
    fileSystem.ensureDirSync(directoryPath);
  }
}

async function writeJsonIfMissing(
  fileSystem: MegumiHomeFileSystem,
  filePath: string,
  data: unknown,
): Promise<void> {
  if (await fileSystem.pathExists(filePath)) {
    return;
  }

  await fileSystem.writeJson(filePath, data, {
    spaces: 2,
  });
}

function writeJsonIfMissingSync(
  fileSystem: MegumiHomeSyncFileSystem,
  filePath: string,
  data: unknown,
): void {
  if (fileSystem.pathExistsSync(filePath)) {
    return;
  }

  fileSystem.writeJsonSync(filePath, data, {
    spaces: 2,
  });
}

async function writeTextIfMissing(
  fileSystem: MegumiHomeFileSystem,
  filePath: string,
  data: string,
): Promise<void> {
  if (await fileSystem.pathExists(filePath)) {
    return;
  }

  await fileSystem.writeFile(filePath, data);
}

function writeTextIfMissingSync(
  fileSystem: MegumiHomeSyncFileSystem,
  filePath: string,
  data: string,
): void {
  if (fileSystem.pathExistsSync(filePath)) {
    return;
  }

  fileSystem.writeFileSync(filePath, data);
}
