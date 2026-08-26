/* Implements Observability local storage with Node file-system capabilities. */
import {
  mkdir,
  appendFile,
  readFile,
  readdir,
  stat,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from 'node:path';
import type {
  ObservabilityEntryKind,
  ObservabilityPersistenceStorage,
} from '@megumi/observability';

export const electronObservabilityStorageAdapter: ObservabilityPersistenceStorage = {
  ensureDirectory: (path) =>
    mkdir(path, { recursive: true }).then(() => undefined),
  appendText: (path, content) => appendFile(path, content, "utf8"),
  readText: (path) => readFile(path, "utf8"),
  readBytes: (path) => readFile(path),
  writeBytes: (path, bytes) => writeFile(path, bytes),
  async listEntries(path) {
    try {
      const entries = await readdir(path, { withFileTypes: true });
      return Promise.all(entries.flatMap((entry) => {
        const kind: ObservabilityEntryKind | undefined = entry.isFile()
          ? 'file'
          : entry.isDirectory()
            ? 'directory'
            : undefined;
        return kind
          ? [stat(join(path, entry.name)).then((value) => ({
              name: entry.name,
              kind,
              size: value.size,
              modifiedAtMs: value.mtimeMs,
            }))]
          : [];
      }));
    } catch (error) {
      if (isMissingPathError(error)) return [];
      throw error;
    }
  },
  async stat(path) {
    try {
      const value = await stat(path);
      const kind: ObservabilityEntryKind | undefined = value.isFile()
        ? 'file'
        : value.isDirectory()
          ? 'directory'
          : undefined;
      return kind
        ? { kind, size: value.size, modifiedAtMs: value.mtimeMs }
        : undefined;
    } catch (error) {
      if (isMissingPathError(error)) return undefined;
      throw error;
    }
  },
  move: (source, destination) => rename(source, destination),
  removeFile: (path) => rm(path, { force: true }),
};

function isMissingPathError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
  return Boolean(descriptor && 'value' in descriptor && descriptor.value === 'ENOENT');
}
