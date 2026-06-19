// Wraps Node filesystem access for owner module host injection.
import fs from 'node:fs/promises';

export interface FileHost {
  readFile(path: string): Promise<Buffer>;
  writeFile(path: string, data: string | Buffer): Promise<void>;
}

export function createFileHost(): FileHost {
  return {
    readFile: (path) => fs.readFile(path),
    writeFile: (path, data) => fs.writeFile(path, data),
  };
}
