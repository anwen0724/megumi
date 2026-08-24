/* Implements Product Host Adapters for headless Node evaluation. */
import { appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import fs from 'fs-extra';
import path from 'node:path';
import type { InitializeMegumiHomeSyncOptions } from '@megumi/home';
import type { InputSourceAccess as ProductInputSourceAccess } from '@megumi/input';
import type { ObservabilityStorage as ProductObservabilityStorage } from '@megumi/observability';
import type { SessionAttachmentFileSystem as ProductSessionAttachmentFileSystem } from '@megumi/session';
import type { SettingsEnvironment as ProductSettingsEnvironment } from '@megumi/settings';
import { resolveOwnedWorkspacePath } from './scoped-workspace-file-system';

export function createNodeSettingsEnvironment(): ProductSettingsEnvironment {
  return {
    readVariable: (name) => process.env[name],
  };
}

export function getNodeProductEnvironment(): { appVersion: string; platform: string; arch: string } {
  return {
    appVersion: 'evaluation',
    platform: process.platform,
    arch: process.arch,
  };
}

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
      resolveBuiltInSystemSkillsPath: () => path.resolve(process.cwd(), 'packages/skills/built-in-skills'),
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

export function createEvaluationInputSourceAccess(workspaceRoot: string): ProductInputSourceAccess {
  return {
    async readImage(source, options) {
      if (options?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      if (source.type !== 'host_file_reference') {
        throw new Error('Evaluation accepts only owned host file references.');
      }
      return readFile(await resolveOwnedWorkspacePath(workspaceRoot, source.referenceId));
    },
    async resolveDocument(source, options) {
      if (options?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      const filePath = await resolveOwnedWorkspacePath(workspaceRoot, source.referenceId);
      const details = await stat(filePath);
      if (!details.isFile()) throw new Error('Evaluation document reference is not a file.');
      return { path: filePath, sizeBytes: details.size };
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
