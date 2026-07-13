/* Implements Observability local storage with Node file-system capabilities. */
import {
  mkdir,
  appendFile,
  readFile,
  readdir,
  stat,
  rename,
  rm,
} from "node:fs/promises";
import type { ObservabilityStorage } from "@megumi/observability";
export const electronObservabilityStorageAdapter: ObservabilityStorage = {
  ensureDirectory: (path) =>
    mkdir(path, { recursive: true }).then(() => undefined),
  appendText: (path, content) => appendFile(path, content, "utf8"),
  readText: (path) => readFile(path, "utf8"),
  async listFiles(path) {
    try {
      const entries = await readdir(path, { withFileTypes: true });
      return Promise.all(
        entries
          .filter((e) => e.isFile())
          .map(async (e) => {
            const value = await stat(`${path}/${e.name}`);
            return {
              name: e.name,
              size: value.size,
              modifiedAtMs: value.mtimeMs,
            };
          }),
      );
    } catch {
      return [];
    }
  },
  async stat(path) {
    try {
      const value = await stat(path);
      return { size: value.size, modifiedAtMs: value.mtimeMs };
    } catch {
      return undefined;
    }
  },
  move: (source, destination) => rename(source, destination),
  remove: (path) => rm(path, { force: true }),
};
