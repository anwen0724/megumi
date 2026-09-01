/* Supplies an isolated Node-backed Megumi Home to Evaluation composition. */
import fs from 'fs-extra';
import path from 'node:path';
import type { InitializeMegumiHomeSyncOptions, MegumiHomeSyncFileSystem } from '@megumi/home';

export function createEvaluationHomeOptions(input: {
  readonly homePath: string;
  readonly now: () => Date;
}): InitializeMegumiHomeSyncOptions {
  return {
    env: { MEGUMI_HOME: path.resolve(input.homePath) },
    homeDirectory: path.dirname(path.resolve(input.homePath)),
    clock: { now: input.now },
    fileSystem: nodeHomeFileSystem,
  };
}

const nodeHomeFileSystem: MegumiHomeSyncFileSystem = {
  ensureDirSync: (directoryPath) => fs.ensureDirSync(directoryPath),
  pathExistsSync: (filePath) => fs.pathExistsSync(filePath),
  writeJsonSync: (filePath, data, options) => fs.writeJsonSync(filePath, data, options),
  writeFileSync: (filePath, data) => fs.writeFileSync(filePath, data),
  copyDirectorySync: (sourcePath, targetPath, options) => fs.copySync(sourcePath, targetPath, options),
  removeDirectorySync: (directoryPath) => fs.removeSync(directoryPath),
  moveDirectorySync: (sourcePath, targetPath) => fs.moveSync(sourcePath, targetPath, { overwrite: false }),
};

