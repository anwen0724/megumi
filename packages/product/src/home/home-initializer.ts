/*
 * Initializes Product Home directories and base files, then delegates bundled
 * resource synchronization to the Home resource owner.
 */
import { createSettingsJsonSchema } from '@megumi/settings';
import {
  buildMegumiHomePaths,
  resolveMegumiHomePath,
  type MegumiHomePaths,
  type ResolveMegumiHomePathOptions,
} from './home-paths';
import {
  installBuiltInSystemSkills,
  installBuiltInSystemSkillsSync,
  type MegumiHomeResourceFileSystem,
  type MegumiHomeResourceLocator,
  type MegumiHomeSyncResourceFileSystem,
} from './home-resources';

export const MEGUMI_HOME_VERSION = 1;
export const MEGUMI_HOME_MIGRATION_ID = 'megumi-home-v1';

export interface MegumiHomeClock {
  now(): Date;
}

export interface MegumiHomeFileSystem extends MegumiHomeResourceFileSystem {
  writeJson(filePath: string, data: unknown, options?: { spaces?: number }): Promise<void>;
  writeFile(filePath: string, data: string): Promise<void>;
}

export interface MegumiHomeSyncFileSystem extends MegumiHomeSyncResourceFileSystem {
  writeJsonSync(filePath: string, data: unknown, options?: { spaces?: number }): void;
  writeFileSync(filePath: string, data: string): void;
}

export interface MegumiHomeVersion {
  readonly version: number;
  readonly createdAt: string;
  readonly lastMigration: string;
}

export interface InitializeMegumiHomeOptions extends ResolveMegumiHomePathOptions {
  readonly fileSystem: MegumiHomeFileSystem;
  readonly clock: MegumiHomeClock;
  readonly resourceLocator?: MegumiHomeResourceLocator;
}

export interface InitializeMegumiHomeSyncOptions extends ResolveMegumiHomePathOptions {
  readonly fileSystem: MegumiHomeSyncFileSystem;
  readonly clock: MegumiHomeClock;
  readonly resourceLocator?: MegumiHomeResourceLocator;
}

/** Creates missing Product Home state without overwriting user-owned files. */
export async function initializeMegumiHome(
  options: InitializeMegumiHomeOptions,
): Promise<MegumiHomePaths> {
  const paths = buildMegumiHomePaths(resolveMegumiHomePath(options));
  await ensureMinimalDirectories(options.fileSystem, paths);
  await writeJsonIfMissing(options.fileSystem, paths.settingsSchemaPath, createMegumiSettingsSchema());
  await writeJsonIfMissing(options.fileSystem, paths.versionPath, createMegumiHomeVersion(options.clock.now()));
  await writeTextIfMissing(options.fileSystem, paths.readmePath, createMegumiHomeReadme());
  await installBuiltInSystemSkills(options.fileSystem, paths, options.resourceLocator);
  return paths;
}

/** Synchronous startup variant used before the desktop modules are composed. */
export function initializeMegumiHomeSync(
  options: InitializeMegumiHomeSyncOptions,
): MegumiHomePaths {
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
    '- `attachments/` for Session-owned managed image copies.',
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

async function ensureMinimalDirectories(
  fileSystem: MegumiHomeFileSystem,
  paths: MegumiHomePaths,
): Promise<void> {
  for (const directoryPath of homeDirectories(paths)) {
    await fileSystem.ensureDir(directoryPath);
  }
}

function ensureMinimalDirectoriesSync(
  fileSystem: MegumiHomeSyncFileSystem,
  paths: MegumiHomePaths,
): void {
  for (const directoryPath of homeDirectories(paths)) {
    fileSystem.ensureDirSync(directoryPath);
  }
}

function homeDirectories(paths: MegumiHomePaths): readonly string[] {
  return [
    paths.homePath,
    paths.skillsPath,
    paths.sqlitePath,
    paths.logsPath,
    paths.cachePath,
    paths.tmpPath,
    paths.attachmentsPath,
  ];
}

async function writeJsonIfMissing(
  fileSystem: MegumiHomeFileSystem,
  filePath: string,
  data: unknown,
): Promise<void> {
  if (await fileSystem.pathExists(filePath)) return;
  await fileSystem.writeJson(filePath, data, { spaces: 2 });
}

function writeJsonIfMissingSync(
  fileSystem: MegumiHomeSyncFileSystem,
  filePath: string,
  data: unknown,
): void {
  if (fileSystem.pathExistsSync(filePath)) return;
  fileSystem.writeJsonSync(filePath, data, { spaces: 2 });
}

async function writeTextIfMissing(
  fileSystem: MegumiHomeFileSystem,
  filePath: string,
  data: string,
): Promise<void> {
  if (await fileSystem.pathExists(filePath)) return;
  await fileSystem.writeFile(filePath, data);
}

function writeTextIfMissingSync(
  fileSystem: MegumiHomeSyncFileSystem,
  filePath: string,
  data: string,
): void {
  if (fileSystem.pathExistsSync(filePath)) return;
  fileSystem.writeFileSync(filePath, data);
}
