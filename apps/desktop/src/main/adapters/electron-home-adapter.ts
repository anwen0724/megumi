// Electron adapter for Megumi Home initialization owned by the product packages.
import fs from 'fs-extra';
import os from 'os';
import { app } from 'electron';
import {
  type InitializeMegumiHomeSyncOptions,
  type MegumiHomeResourceLocator,
  type MegumiHomeSyncFileSystem,
} from '@megumi/product/home';
import { resolveProductSystemSkillsPath } from '@megumi/product';

export function createElectronMegumiHomeSyncOptions(): InitializeMegumiHomeSyncOptions {
  return {
    env: process.env,
    homeDirectory: os.homedir(),
    fileSystem: createElectronMegumiHomeFileSystem(),
    clock: {
      now: () => new Date(),
    },
    resourceLocator: createElectronMegumiHomeResourceLocator(),
  };
}

function createElectronMegumiHomeResourceLocator(): MegumiHomeResourceLocator {
  return {
    resolveBuiltInSystemSkillsPath: () => resolveProductSystemSkillsPath({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      cwd: process.cwd(),
    }),
  };
}

function createElectronMegumiHomeFileSystem(): MegumiHomeSyncFileSystem {
  return {
    ensureDirSync: (directoryPath) => fs.ensureDirSync(directoryPath),
    pathExistsSync: (filePath) => fs.pathExistsSync(filePath),
    writeJsonSync: (filePath, data, options) => fs.writeJsonSync(filePath, data, options),
    writeFileSync: (filePath, data) => fs.writeFileSync(filePath, data),
    copyDirectorySync: (sourcePath, targetPath, options) => fs.copySync(sourcePath, targetPath, options),
    removeDirectorySync: (directoryPath) => fs.removeSync(directoryPath),
    moveDirectorySync: (sourcePath, targetPath) => fs.moveSync(sourcePath, targetPath, { overwrite: false }),
  };
}
