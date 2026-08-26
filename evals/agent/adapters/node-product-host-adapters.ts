/* Implements Product Host Adapters for headless Node evaluation. */
import { appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import fs from 'fs-extra';
import path from 'node:path';
import type { InitializeMegumiHomeSyncOptions } from '@megumi/home';
import type { InputSourceAccess as ProductInputSourceAccess } from '@megumi/input';
import type {
  ObservabilityEntryKind,
  ObservabilityPersistenceStorage as ProductObservabilityStorage,
} from '@megumi/observability';
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
      resolveBuiltInSystemSkillsPath: () => path.resolve(process.cwd(), 'packages/agent/skills/built-in-skills'),
    },
  };
}

export const nodeObservabilityStorage: ProductObservabilityStorage = {
  ensureDirectory: (directoryPath) => mkdir(directoryPath, { recursive: true }).then(() => undefined),
  appendText: (filePath, content) => appendFile(filePath, content, 'utf8'),
  readText: (filePath) => readFile(filePath, 'utf8'),
  readBytes: (filePath) => readFile(filePath),
  writeBytes: (filePath, bytes) => writeFile(filePath, bytes),
  async listEntries(directoryPath) {
    let entries;
    try {
      entries = await readdir(directoryPath, { withFileTypes: true });
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return [];
      throw error;
    }
    return Promise.all(entries.flatMap((entry) => {
      const kind: ObservabilityEntryKind | undefined = entry.isFile()
        ? 'file'
        : entry.isDirectory()
          ? 'directory'
          : undefined;
      return kind
        ? [stat(path.join(directoryPath, entry.name)).then((details) => ({
            name: entry.name,
            kind,
            size: details.size,
            modifiedAtMs: details.mtimeMs,
          }))]
        : [];
    }));
  },
  async stat(filePath) {
    try {
      const details = await stat(filePath);
      const kind: ObservabilityEntryKind | undefined = details.isFile()
        ? 'file'
        : details.isDirectory()
          ? 'directory'
          : undefined;
      return kind ? { kind, size: details.size, modifiedAtMs: details.mtimeMs } : undefined;
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return undefined;
      throw error;
    }
  },
  move: (sourcePath, destinationPath) => rename(sourcePath, destinationPath),
  removeFile: (filePath) => rm(filePath, { force: true }),
};

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
  return descriptor && 'value' in descriptor && typeof descriptor.value === 'string'
    ? descriptor.value
    : undefined;
}

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
