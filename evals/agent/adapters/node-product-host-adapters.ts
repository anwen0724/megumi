/* Implements Product Home and Observability host ports for headless Node evaluation. */
import { appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import fs from 'fs-extra';
import path from 'node:path';
import type { InitializeMegumiHomeSyncOptions } from '@megumi/product/home';
import type {
  ProductInputFileReader,
  ProductObservabilityStorage,
  ProductSessionAttachmentFileSystem,
} from '@megumi/product/composition';
import { resolveProductSystemSkillsPath } from '@megumi/product';
import { resolveOwnedWorkspacePath } from './scoped-workspace-file-system';

export function createEvaluationHomeOptions(homeRoot: string): InitializeMegumiHomeSyncOptions {
  return {
    env: { MEGUMI_HOME: homeRoot },
    homeDirectory: path.dirname(homeRoot),
    fileSystem: {
      ensureDirSync: fs.ensureDirSync,
      pathExistsSync: fs.pathExistsSync,
      writeJsonSync: fs.writeJsonSync,
      writeFileSync: fs.writeFileSync,
      copyDirectorySync: fs.copySync,
      removeDirectorySync: fs.removeSync,
      moveDirectorySync: (sourcePath, targetPath) => fs.moveSync(sourcePath, targetPath, { overwrite: false }),
    },
    clock: { now: () => new Date() },
    resourceLocator: {
      resolveBuiltInSystemSkillsPath: () => resolveProductSystemSkillsPath({
        isPackaged: false,
        resourcesPath: process.cwd(),
        cwd: process.cwd(),
      }),
    },
  };
}

export const nodeObservabilityStorage: ProductObservabilityStorage = {
  ensureDirectory: (directoryPath) => mkdir(directoryPath, { recursive: true }).then(() => undefined),
  appendText: (filePath, content) => appendFile(filePath, content, 'utf8'),
  readText: (filePath) => readFile(filePath, 'utf8'),
  async listFiles(directoryPath) {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const output = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const details = await stat(path.join(directoryPath, entry.name));
      output.push({ name: entry.name, size: details.size, modifiedAtMs: details.mtimeMs });
    }
    return output;
  },
  async stat(filePath) {
    try {
      const details = await stat(filePath);
      return { size: details.size, modifiedAtMs: details.mtimeMs };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  },
  move: (sourcePath, destinationPath) => rename(sourcePath, destinationPath),
  remove: (filePath) => rm(filePath, { force: true }),
};

export function createEvaluationInputFileReader(workspaceRoot: string): ProductInputFileReader {
  return {
    async readFile(source) {
      if (source.type !== 'host_file_reference') {
        throw new Error('Evaluation accepts only owned host file references.');
      }
      return readFile(await resolveOwnedWorkspacePath(workspaceRoot, source.reference_id));
    },
  };
}

export const nodeSessionAttachmentFileSystem: ProductSessionAttachmentFileSystem = {
  ensureDirectory: (directoryPath) => mkdir(directoryPath, { recursive: true }).then(() => undefined),
  writeFile: (filePath, bytes) => writeFile(filePath, bytes),
  moveFile: (sourcePath, targetPath) => rename(sourcePath, targetPath),
  readFile,
  removeFile: (filePath) => rm(filePath, { force: true }),
};

export async function writeEvaluationTextFile(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
}
