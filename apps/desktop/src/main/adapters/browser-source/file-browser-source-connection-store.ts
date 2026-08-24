/* Persists only the loopback port and irreversible device-token digest in Megumi Home. */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type {
  BrowserSourceConnectionRecord,
  BrowserSourceConnectionStore,
} from './browser-source-loopback-server';

const RecordSchema = z.object({
  port: z.number().int().min(0).max(65_535),
  tokenHash: z.string().regex(/^[a-f\d]{64}$/u).optional(),
}).strict();

export function createFileBrowserSourceConnectionStore(filePath: string): BrowserSourceConnectionStore {
  return {
    read() {
      try {
        return RecordSchema.parse(JSON.parse(fs.readFileSync(filePath, 'utf8')));
      } catch {
        return undefined;
      }
    },
    write(record: BrowserSourceConnectionRecord) {
      const parsed = RecordSchema.parse(record);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const temporaryPath = `${filePath}.tmp`;
      fs.writeFileSync(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temporaryPath, filePath);
    },
  };
}
