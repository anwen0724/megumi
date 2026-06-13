import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import type { PermissionRules } from '@megumi/shared/permission';

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

export interface MegumiProviderConfig {
  enabled: boolean;
  kind: 'openai-compatible' | 'anthropic';
  displayName: string;
  baseUrl?: string;
  defaultModel: string;
  apiKeyEnv?: string;
  apiKey?: string;
  secretRef?: string;
}

export interface MegumiHomeConfig {
  version: number;
  app: {
    theme: string;
    language: string;
  };
  chat: {
    defaultProvider: string;
  };
  providers: Record<string, MegumiProviderConfig>;
  permissions?: PermissionRules;
}

export interface MegumiHomeVersion {
  version: number;
  createdAt: string;
  lastMigration: string;
}

export interface MegumiHomePaths {
  homePath: string;
  configPath: string;
  settingsPath: string;
  configSchemaPath: string;
  readmePath: string;
  versionPath: string;
  sqlitePath: string;
  secretsPath: string;
  providerSecretsPath: string;
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
  const secretsPath = path.join(resolvedHomePath, 'secrets');

  return {
    homePath: resolvedHomePath,
    configPath: path.join(resolvedHomePath, 'config.json'),
    settingsPath: path.join(resolvedHomePath, 'settings.json'),
    configSchemaPath: path.join(resolvedHomePath, 'config.schema.json'),
    readmePath: path.join(resolvedHomePath, 'README.md'),
    versionPath: path.join(resolvedHomePath, 'version.json'),
    sqlitePath: path.join(resolvedHomePath, 'sqlite'),
    secretsPath,
    providerSecretsPath: path.join(secretsPath, 'providers'),
    logsPath: path.join(resolvedHomePath, 'logs'),
    cachePath: path.join(resolvedHomePath, 'cache'),
    tmpPath: path.join(resolvedHomePath, 'tmp'),
  };
}

export async function initializeMegumiHome(options: InitializeMegumiHomeOptions): Promise<MegumiHomePaths> {
  const paths = buildMegumiHomePaths(resolveMegumiHomePath(options));

  await ensureMinimalDirectories(options.fileSystem, paths);
  await writeJsonIfMissing(options.fileSystem, paths.configPath, createDefaultMegumiConfig());
  await writeJsonIfMissing(options.fileSystem, paths.configSchemaPath, createMegumiConfigSchema());
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
  writeJsonIfMissingSync(options.fileSystem, paths.configPath, createDefaultMegumiConfig());
  writeJsonIfMissingSync(options.fileSystem, paths.configSchemaPath, createMegumiConfigSchema());
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

export function createDefaultMegumiConfig(): MegumiHomeConfig {
  return {
    version: MEGUMI_HOME_VERSION,
    app: {
      theme: 'megumi-warm',
      language: 'zh-CN',
    },
    chat: {
      defaultProvider: 'deepseek',
    },
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
        baseUrl: 'https://api.anthropic.com',
        defaultModel: 'claude-sonnet-4-6',
        apiKeyEnv: 'ANTHROPIC_API_KEY',
      },
    },
  };
}

export function createMegumiHomeVersion(createdAt: Date): MegumiHomeVersion {
  return {
    version: MEGUMI_HOME_VERSION,
    createdAt: createdAt.toISOString(),
    lastMigration: MEGUMI_HOME_MIGRATION_ID,
  };
}

export function createMegumiConfigSchema(): Record<string, unknown> {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Megumi config',
    type: 'object',
    additionalProperties: false,
    required: ['version', 'app', 'chat', 'providers'],
    properties: {
      version: {
        type: 'integer',
        const: MEGUMI_HOME_VERSION,
      },
      app: {
        type: 'object',
        additionalProperties: false,
        required: ['theme', 'language'],
        properties: {
          theme: {
            type: 'string',
          },
          language: {
            type: 'string',
          },
        },
      },
      chat: {
        type: 'object',
        additionalProperties: false,
        required: ['defaultProvider'],
        properties: {
          defaultProvider: {
            type: 'string',
          },
        },
      },
      providers: {
        type: 'object',
        additionalProperties: {
          type: 'object',
          additionalProperties: false,
          required: ['enabled', 'kind', 'displayName', 'defaultModel'],
          properties: {
            enabled: {
              type: 'boolean',
            },
            kind: {
              enum: ['openai-compatible', 'anthropic'],
            },
            displayName: {
              type: 'string',
            },
            baseUrl: {
              type: 'string',
            },
            defaultModel: {
              type: 'string',
            },
            apiKeyEnv: {
              type: 'string',
            },
            apiKey: {
              type: 'string',
            },
            secretRef: {
              type: 'string',
            },
          },
        },
      },
      permissions: {
        type: 'object',
        additionalProperties: false,
        properties: {
          allow: {
            type: 'array',
            items: {
              type: 'string',
            },
          },
          ask: {
            type: 'array',
            items: {
              type: 'string',
            },
          },
          deny: {
            type: 'array',
            items: {
              type: 'string',
            },
          },
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
    '- `config.json` for app preferences, provider configuration, model defaults, and intentional plaintext API keys.',
    '',
    'Managed by Megumi:',
    '',
    '- `config.schema.json` for editor validation.',
    '- `version.json` for home directory metadata.',
    '- `sqlite/` for structured runtime state.',
    '- `secrets/providers/` for UI-saved encrypted provider API keys.',
    '- `logs/` for application logs.',
    '- `cache/` for regenerable cache data.',
    '- `tmp/` for temporary files.',
    '',
    'Credential priority:',
    '',
    '1. Environment variable configured by `apiKeyEnv`.',
    '2. Plaintext `apiKey` in `config.json` when intentionally provided.',
    '3. UI-saved encrypted key under `secrets/providers/`.',
    '',
    'Set `MEGUMI_HOME` to use a different Megumi Home directory.',
    '',
  ].join('\n');
}

async function ensureMinimalDirectories(fileSystem: MegumiHomeFileSystem, paths: MegumiHomePaths): Promise<void> {
  for (const directoryPath of [
    paths.homePath,
    paths.sqlitePath,
    paths.secretsPath,
    paths.providerSecretsPath,
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
    paths.secretsPath,
    paths.providerSecretsPath,
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

