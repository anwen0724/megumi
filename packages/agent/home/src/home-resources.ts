/*
 * Installs Megumi Home resources. System Skills are swapped atomically
 * so an interrupted update cannot expose a partially copied resource tree.
 */
import path from 'node:path';
import type { MegumiHomePaths } from './home-paths';

export interface MegumiHomeResourceLocator {
  resolveBuiltInSystemSkillsPath(): string | undefined;
}

export interface MegumiHomeResourceFileSystem {
  ensureDir(directoryPath: string): Promise<void>;
  pathExists(filePath: string): Promise<boolean>;
  copyDirectory?(sourcePath: string, targetPath: string, options?: {
    overwrite?: boolean;
    errorOnExist?: boolean;
  }): Promise<void>;
  removeDirectory?(directoryPath: string): Promise<void>;
  moveDirectory?(sourcePath: string, targetPath: string): Promise<void>;
}

export interface MegumiHomeSyncResourceFileSystem {
  ensureDirSync(directoryPath: string): void;
  pathExistsSync(filePath: string): boolean;
  copyDirectorySync?(sourcePath: string, targetPath: string, options?: {
    overwrite?: boolean;
    errorOnExist?: boolean;
  }): void;
  removeDirectorySync?(directoryPath: string): void;
  moveDirectorySync?(sourcePath: string, targetPath: string): void;
}

/** Synchronizes built-in System Skills into Megumi Home with an atomic swap. */
export async function installBuiltInSystemSkills(
  fileSystem: MegumiHomeResourceFileSystem,
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

  const atomicFileSystem = fileSystem as MegumiHomeResourceFileSystem & Required<Pick<
    MegumiHomeResourceFileSystem,
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

/** Synchronous counterpart used during desktop startup composition. */
export function installBuiltInSystemSkillsSync(
  fileSystem: MegumiHomeSyncResourceFileSystem,
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

  const atomicFileSystem = fileSystem as MegumiHomeSyncResourceFileSystem & Required<Pick<
    MegumiHomeSyncResourceFileSystem,
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
  fileSystem: Required<Pick<MegumiHomeResourceFileSystem, 'pathExists' | 'removeDirectory' | 'moveDirectory'>>,
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
  fileSystem: Required<Pick<MegumiHomeSyncResourceFileSystem, 'pathExistsSync' | 'removeDirectorySync' | 'moveDirectorySync'>>,
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
  fileSystem: Required<Pick<MegumiHomeResourceFileSystem, 'pathExists' | 'removeDirectory' | 'moveDirectory'>>,
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
  fileSystem: Required<Pick<MegumiHomeSyncResourceFileSystem, 'pathExistsSync' | 'removeDirectorySync' | 'moveDirectorySync'>>,
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
  fileSystem: Required<Pick<MegumiHomeResourceFileSystem, 'pathExists' | 'removeDirectory'>>,
  directoryPath: string,
): Promise<void> {
  if (await fileSystem.pathExists(directoryPath)) {
    await fileSystem.removeDirectory(directoryPath);
  }
}

function removeIfPresentSync(
  fileSystem: Required<Pick<MegumiHomeSyncResourceFileSystem, 'pathExistsSync' | 'removeDirectorySync'>>,
  directoryPath: string,
): void {
  if (fileSystem.pathExistsSync(directoryPath)) {
    fileSystem.removeDirectorySync(directoryPath);
  }
}
