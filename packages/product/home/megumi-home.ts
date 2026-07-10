/*
 * Owns the Megumi product home layout, metadata initialization, and built-in
 * system skill seed installation.
 */
import path from 'node:path';
import { createSettingsJsonSchema } from '../../coding-agent/settings';

export const MEGUMI_HOME_VERSION = 1;
export const MEGUMI_HOME_MIGRATION_ID = 'megumi-home-v1';

export interface MegumiHomeEnv {
  MEGUMI_HOME?: string;
}

export interface MegumiHomeClock {
  now(): Date;
}

export interface MegumiHomeResourceLocator {
  resolveBuiltInSystemSkillsPath(): string | undefined;
}

export interface MegumiHomeFileSystem {
  ensureDir(directoryPath: string): Promise<void>;
  pathExists(filePath: string): Promise<boolean>;
  writeJson(filePath: string, data: unknown, options?: { spaces?: number }): Promise<void>;
  writeFile(filePath: string, data: string): Promise<void>;
  copyDirectory?(sourcePath: string, targetPath: string, options?: { overwrite?: boolean; errorOnExist?: boolean }): Promise<void>;
}

export interface MegumiHomeSyncFileSystem {
  ensureDirSync(directoryPath: string): void;
  pathExistsSync(filePath: string): boolean;
  writeJsonSync(filePath: string, data: unknown, options?: { spaces?: number }): void;
  writeFileSync(filePath: string, data: string): void;
  copyDirectorySync?(sourcePath: string, targetPath: string, options?: { overwrite?: boolean; errorOnExist?: boolean }): void;
}

export interface MegumiHomeVersion {
  version: number;
  createdAt: string;
  lastMigration: string;
}

export interface MegumiHomePaths {
  homePath: string;
  skillsPath: string;
  systemSkillsPath: string;
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
  resourceLocator?: MegumiHomeResourceLocator;
}

export interface InitializeMegumiHomeSyncOptions extends ResolveMegumiHomePathOptions {
  fileSystem: MegumiHomeSyncFileSystem;
  clock: MegumiHomeClock;
  resourceLocator?: MegumiHomeResourceLocator;
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
    skillsPath: path.join(resolvedHomePath, 'skills'),
    systemSkillsPath: path.join(resolvedHomePath, 'skills', '.system'),
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
  await installBuiltInSystemSkills(options.fileSystem, paths, options.resourceLocator);

  return paths;
}

export function initializeMegumiHomeSync(options: InitializeMegumiHomeSyncOptions): MegumiHomePaths {
  const paths = buildMegumiHomePaths(resolveMegumiHomePath(options));

  ensureMinimalDirectoriesSync(options.fileSystem, paths);
  writeJsonIfMissingSync(options.fileSystem, paths.settingsSchemaPath, createMegumiSettingsSchema());
  writeJsonIfMissingSync(options.fileSystem, paths.versionPath, createMegumiHomeVersion(options.clock.now()));
  writeTextIfMissingSync(options.fileSystem, paths.readmePath, createMegumiHomeReadme());
  installBuiltInSystemSkillsSync(options.fileSystem, paths, options.resourceLocator);

  return paths;
}

export function createMegumiHomeVersion(createdAt: Date): MegumiHomeVersion {
  return {
    version: MEGUMI_HOME_VERSION,
    createdAt: createdAt.toISOString(),
    lastMigration: MEGUMI_HOME_MIGRATION_ID,
  };
}

export function createMegumiSettingsSchema(): Record<string, unknown> {
  return createSettingsJsonSchema();
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
    '- `skills/` for user-installed skills.',
    '',
    'Managed by Megumi:',
    '',
    '- `settings.schema.json` for editor validation.',
    '- `version.json` for home directory metadata.',
    '- `skills/.system/` for Megumi-provided system skills.',
    '- `sqlite/` for structured runtime state.',
    '- `logs/` for application logs.',
    '- `cache/` for regenerable cache data.',
    '- `tmp/` for temporary files.',
    '',
    'Credential priority:',
    '',
    '1. Plaintext `api_key` in `settings.json` when intentionally provided.',
    '2. Environment variable configured by `api_key_env`.',
    '',
    'Set `MEGUMI_HOME` to use a different Megumi Home directory.',
    '',
  ].join('\n');
}

async function ensureMinimalDirectories(fileSystem: MegumiHomeFileSystem, paths: MegumiHomePaths): Promise<void> {
  for (const directoryPath of homeDirectories(paths)) {
    await fileSystem.ensureDir(directoryPath);
  }
}

function ensureMinimalDirectoriesSync(fileSystem: MegumiHomeSyncFileSystem, paths: MegumiHomePaths): void {
  for (const directoryPath of homeDirectories(paths)) {
    fileSystem.ensureDirSync(directoryPath);
  }
}

function homeDirectories(paths: MegumiHomePaths): string[] {
  return [
    paths.homePath,
    paths.skillsPath,
    paths.systemSkillsPath,
    paths.sqlitePath,
    paths.logsPath,
    paths.cachePath,
    paths.tmpPath,
  ];
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

async function installBuiltInSystemSkills(
  fileSystem: MegumiHomeFileSystem,
  paths: MegumiHomePaths,
  resourceLocator?: MegumiHomeResourceLocator,
): Promise<void> {
  const resolvedSeedPath = resourceLocator?.resolveBuiltInSystemSkillsPath()?.trim();

  if (!resolvedSeedPath || !fileSystem.copyDirectory || !(await fileSystem.pathExists(resolvedSeedPath))) {
    return;
  }

  await fileSystem.copyDirectory(path.resolve(resolvedSeedPath), paths.systemSkillsPath, {
    overwrite: false,
    errorOnExist: false,
  });
}

function installBuiltInSystemSkillsSync(
  fileSystem: MegumiHomeSyncFileSystem,
  paths: MegumiHomePaths,
  resourceLocator?: MegumiHomeResourceLocator,
): void {
  const resolvedSeedPath = resourceLocator?.resolveBuiltInSystemSkillsPath()?.trim();

  if (!resolvedSeedPath || !fileSystem.copyDirectorySync || !fileSystem.pathExistsSync(resolvedSeedPath)) {
    return;
  }

  fileSystem.copyDirectorySync(path.resolve(resolvedSeedPath), paths.systemSkillsPath, {
    overwrite: false,
    errorOnExist: false,
  });
}
