// Electron adapter for Megumi Home initialization owned by the product packages.
import fs from 'fs-extra';
import os from 'os';
import path from 'node:path';
import { app } from 'electron';
import {
  initializeMegumiHome,
  initializeMegumiHomeSync,
  resolveMegumiHomePath,
  buildMegumiHomePaths,
  createMegumiHomeVersion,
  createMegumiSettingsSchema,
  type InitializeMegumiHomeOptions,
  type InitializeMegumiHomeSyncOptions,
  type MegumiHomeClock,
  type MegumiHomeEnv,
  type MegumiHomeFileSystem,
  type MegumiHomePaths,
  type MegumiHomeResourceLocator,
  type MegumiHomeSyncFileSystem,
  type MegumiHomeVersion,
} from '@megumi/product/home';

export {
  buildMegumiHomePaths,
  createMegumiHomeVersion,
  createMegumiSettingsSchema,
  initializeMegumiHome,
  initializeMegumiHomeSync,
  resolveMegumiHomePath,
};
export type {
  InitializeMegumiHomeOptions,
  InitializeMegumiHomeSyncOptions,
  MegumiHomeClock,
  MegumiHomeEnv,
  MegumiHomeFileSystem,
  MegumiHomePaths,
  MegumiHomeSyncFileSystem,
  MegumiHomeVersion,
};

export async function initializeElectronMegumiHome(): Promise<MegumiHomePaths> {
  return initializeMegumiHome({
    env: process.env,
    homeDirectory: os.homedir(),
    fileSystem: createElectronMegumiHomeFileSystem(),
    clock: {
      now: () => new Date(),
    },
    resourceLocator: createElectronMegumiHomeResourceLocator(),
  });
}

export function initializeElectronMegumiHomeSync(): MegumiHomePaths {
  return initializeMegumiHomeSync({
    env: process.env,
    homeDirectory: os.homedir(),
    fileSystem: createElectronMegumiHomeFileSystem(),
    clock: {
      now: () => new Date(),
    },
    resourceLocator: createElectronMegumiHomeResourceLocator(),
  });
}

function createElectronMegumiHomeResourceLocator(): MegumiHomeResourceLocator {
  return {
    resolveBuiltInSystemSkillsPath: () => app.isPackaged
      ? path.resolve(process.resourcesPath, 'product', 'system-skills')
      : path.resolve(process.cwd(), 'packages', 'coding-agent', 'skills', 'built-in-skills'),
  };
}

function createElectronMegumiHomeFileSystem(): MegumiHomeFileSystem & MegumiHomeSyncFileSystem {
  return {
    ensureDir: (directoryPath) => fs.ensureDir(directoryPath),
    pathExists: (filePath) => fs.pathExists(filePath),
    writeJson: (filePath, data, options) => fs.writeJson(filePath, data, options),
    writeFile: (filePath, data) => fs.writeFile(filePath, data),
    copyDirectory: (sourcePath, targetPath, options) => fs.copy(sourcePath, targetPath, options),
    ensureDirSync: (directoryPath) => fs.ensureDirSync(directoryPath),
    pathExistsSync: (filePath) => fs.pathExistsSync(filePath),
    writeJsonSync: (filePath, data, options) => fs.writeJsonSync(filePath, data, options),
    writeFileSync: (filePath, data) => fs.writeFileSync(filePath, data),
    copyDirectorySync: (sourcePath, targetPath, options) => fs.copySync(sourcePath, targetPath, options),
  };
}
