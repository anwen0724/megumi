// Provides a small filesystem boundary for memory Markdown mirrors and diagnostics.
// Tests use a fake implementation; production uses Node fs/promises.
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface MemoryRuntimeFileSystem {
  readText(filePath: string): Promise<
    | { ok: true; content: string }
    | { ok: false; reason: 'not_found' | 'read_failed'; message: string }
  >;
  writeTextAtomic(filePath: string, content: string): Promise<
    | { ok: true }
    | { ok: false; reason: 'write_failed'; message: string }
  >;
  appendJsonLine(filePath: string, entry: unknown): Promise<
    | { ok: true }
    | { ok: false; reason: 'append_failed'; message: string }
  >;
}

export function createNodeMemoryRuntimeFileSystem(): MemoryRuntimeFileSystem {
  return {
    async readText(filePath) {
      try {
        return { ok: true, content: await fs.readFile(filePath, 'utf8') };
      } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
          return { ok: false, reason: 'not_found', message: `File not found: ${filePath}` };
        }
        return { ok: false, reason: 'read_failed', message: errorMessage(error) };
      }
    },
    async writeTextAtomic(filePath, content) {
      const directory = path.dirname(filePath);
      const temporaryPath = path.join(directory, `${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
      try {
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(temporaryPath, content, 'utf8');
        await fs.rename(temporaryPath, filePath);
        return { ok: true };
      } catch (error) {
        await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
        return { ok: false, reason: 'write_failed', message: errorMessage(error) };
      }
    },
    async appendJsonLine(filePath, entry) {
      try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.appendFile(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: 'append_failed', message: errorMessage(error) };
      }
    },
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
