/*
 * Owns the Megumi product home layout, metadata initialization, and built-in
 * system Skill source synchronization.
 */
import path from 'node:path';
import { createSettingsJsonSchema } from '../../agent/settings';

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
  removeDirectory?(directoryPath: string): Promise<void>;
  moveDirectory?(sourcePath: string, targetPath: string): Promise<void>;
}

export interface MegumiHomeSyncFileSystem {
  ensureDirSync(directoryPath: string): void;
  pathExistsSync(filePath: string): boolean;
  writeJsonSync(filePath: string, data: unknown, options?: { spaces?: number }): void;
  writeFileSync(filePath: string, data: string): void;
  copyDirectorySync?(sourcePath: string, targetPath: string, options?: { overwrite?: boolean; errorOnExist?: boolean }): void;
  removeDirectorySync?(directoryPath: string): void;
  moveDirectorySync?(sourcePath: string, targetPath: string): void;
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
  attachmentsPath: string;
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
    attachmentsPath: path.join(resolvedHomePath, 'attachments'),
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

  if (!resourceLocator) {
    await fileSystem.ensureDir(paths.systemSkillsPath);
    return;
  }
  if (!resolvedSeedPath) {
    throw new Error('Built-in system Skill resource path is unavailable.');
  }
  if (!(await fileSystem.pathExists(resolvedSeedPath))) {
    throw new Error(`Built-in system Skill resources do not exist: ${resolvedSeedPath}`);
  }
  if (!fileSystem.copyDirectory || !fileSystem.removeDirectory || !fileSystem.moveDirectory) {
    throw new Error('Megumi Home filesystem does not support atomic system Skill synchronization.');
  }
  const atomicFileSystem = fileSystem as MegumiHomeFileSystem & Required<Pick<
    MegumiHomeFileSystem,
    'copyDirectory' | 'removeDirectory' | 'moveDirectory'
  >>;

  const stagingPath = `${paths.systemSkillsPath}.staging`;
  const backupPath = `${paths.systemSkillsPath}.backup`;
  await prepareSystemSkillSwap(atomicFileSystem, paths.systemSkillsPath, stagingPath, backupPath);

  try {
    await atomicFileSystem.copyDirectory(path.resolve(resolvedSeedPath), stagingPath, {
      overwrite: false,
      errorOnExist: false,
    });
    if (!(await fileSystem.pathExists(stagingPath))) {
      throw new Error('Built-in system Skill staging directory was not created.');
    }
  } catch (error) {
    await removeIfPresent(atomicFileSystem, stagingPath);
    throw error;
  }

  try {
    if (await fileSystem.pathExists(paths.systemSkillsPath)) {
      await atomicFileSystem.moveDirectory(paths.systemSkillsPath, backupPath);
    }
    await atomicFileSystem.moveDirectory(stagingPath, paths.systemSkillsPath);
  } catch (error) {
    await restoreSystemSkillBackup(atomicFileSystem, paths.systemSkillsPath, stagingPath, backupPath);
    throw error;
  }

  await removeIfPresent(atomicFileSystem, backupPath);
}

function installBuiltInSystemSkillsSync(
  fileSystem: MegumiHomeSyncFileSystem,
  paths: MegumiHomePaths,
  resourceLocator?: MegumiHomeResourceLocator,
): void {
  const resolvedSeedPath = resourceLocator?.resolveBuiltInSystemSkillsPath()?.trim();

  if (!resourceLocator) {
    fileSystem.ensureDirSync(paths.systemSkillsPath);
    return;
  }
  if (!resolvedSeedPath) {
    throw new Error('Built-in system Skill resource path is unavailable.');
  }
  if (!fileSystem.pathExistsSync(resolvedSeedPath)) {
    throw new Error(`Built-in system Skill resources do not exist: ${resolvedSeedPath}`);
  }
  if (!fileSystem.copyDirectorySync || !fileSystem.removeDirectorySync || !fileSystem.moveDirectorySync) {
    throw new Error('Megumi Home filesystem does not support atomic system Skill synchronization.');
  }
  const atomicFileSystem = fileSystem as MegumiHomeSyncFileSystem & Required<Pick<
    MegumiHomeSyncFileSystem,
    'copyDirectorySync' | 'removeDirectorySync' | 'moveDirectorySync'
  >>;

  const stagingPath = `${paths.systemSkillsPath}.staging`;
  const backupPath = `${paths.systemSkillsPath}.backup`;
  prepareSystemSkillSwapSync(atomicFileSystem, paths.systemSkillsPath, stagingPath, backupPath);

  try {
    atomicFileSystem.copyDirectorySync(path.resolve(resolvedSeedPath), stagingPath, {
      overwrite: false,
      errorOnExist: false,
    });
    if (!fileSystem.pathExistsSync(stagingPath)) {
      throw new Error('Built-in system Skill staging directory was not created.');
    }
  } catch (error) {
    removeIfPresentSync(atomicFileSystem, stagingPath);
    throw error;
  }

  try {
    if (fileSystem.pathExistsSync(paths.systemSkillsPath)) {
      atomicFileSystem.moveDirectorySync(paths.systemSkillsPath, backupPath);
    }
    atomicFileSystem.moveDirectorySync(stagingPath, paths.systemSkillsPath);
  } catch (error) {
    restoreSystemSkillBackupSync(atomicFileSystem, paths.systemSkillsPath, stagingPath, backupPath);
    throw error;
  }

  removeIfPresentSync(atomicFileSystem, backupPath);
}

async function prepareSystemSkillSwap(
  fileSystem: Required<Pick<MegumiHomeFileSystem, 'pathExists' | 'removeDirectory' | 'moveDirectory'>>,
  systemSkillsPath: string,
  stagingPath: string,
  backupPath: string,
): Promise<void> {
  if (await fileSystem.pathExists(backupPath)) {
    if (await fileSystem.pathExists(systemSkillsPath)) {
      await fileSystem.removeDirectory(backupPath);
    } else {
      await fileSystem.moveDirectory(backupPath, systemSkillsPath);
    }
  }
  await removeIfPresent(fileSystem, stagingPath);
}

function prepareSystemSkillSwapSync(
  fileSystem: Required<Pick<MegumiHomeSyncFileSystem, 'pathExistsSync' | 'removeDirectorySync' | 'moveDirectorySync'>>,
  systemSkillsPath: string,
  stagingPath: string,
  backupPath: string,
): void {
  if (fileSystem.pathExistsSync(backupPath)) {
    if (fileSystem.pathExistsSync(systemSkillsPath)) {
      fileSystem.removeDirectorySync(backupPath);
    } else {
      fileSystem.moveDirectorySync(backupPath, systemSkillsPath);
    }
  }
  removeIfPresentSync(fileSystem, stagingPath);
}

async function restoreSystemSkillBackup(
  fileSystem: Required<Pick<MegumiHomeFileSystem, 'pathExists' | 'removeDirectory' | 'moveDirectory'>>,
  systemSkillsPath: string,
  stagingPath: string,
  backupPath: string,
): Promise<void> {
  await removeIfPresent(fileSystem, stagingPath);
  if (!(await fileSystem.pathExists(systemSkillsPath)) && await fileSystem.pathExists(backupPath)) {
    await fileSystem.moveDirectory(backupPath, systemSkillsPath);
  }
}

function restoreSystemSkillBackupSync(
  fileSystem: Required<Pick<MegumiHomeSyncFileSystem, 'pathExistsSync' | 'removeDirectorySync' | 'moveDirectorySync'>>,
  systemSkillsPath: string,
  stagingPath: string,
  backupPath: string,
): void {
  removeIfPresentSync(fileSystem, stagingPath);
  if (!fileSystem.pathExistsSync(systemSkillsPath) && fileSystem.pathExistsSync(backupPath)) {
    fileSystem.moveDirectorySync(backupPath, systemSkillsPath);
  }
}

async function removeIfPresent(
  fileSystem: Required<Pick<MegumiHomeFileSystem, 'pathExists' | 'removeDirectory'>>,
  directoryPath: string,
): Promise<void> {
  if (await fileSystem.pathExists(directoryPath)) {
    await fileSystem.removeDirectory(directoryPath);
  }
}

function removeIfPresentSync(
  fileSystem: Required<Pick<MegumiHomeSyncFileSystem, 'pathExistsSync' | 'removeDirectorySync'>>,
  directoryPath: string,
): void {
  if (fileSystem.pathExistsSync(directoryPath)) {
    fileSystem.removeDirectorySync(directoryPath);
  }
}
