/* Reads JSON documents without side effects for configuration and credentials. */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const DocumentSchema = z.record(z.unknown());

/** Replaces one JSON document only after its complete contents have been written. */
export function writeJsonFile(filePath: string, document: Record<string, unknown>): void {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(directory, `${path.basename(filePath)}.${randomUUID()}.tmp`);
  fs.mkdirSync(directory, { recursive: true });
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

/** Missing files contribute no explicit values; unexpected IO errors propagate. */
export function readJsonFile(filePath: string):
  | { status: 'ok'; document: Record<string, unknown> }
  | { status: 'invalid' } {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { status: 'ok', document: {} };
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    if (error instanceof SyntaxError) return { status: 'invalid' };
    throw error;
  }
  const result = DocumentSchema.safeParse(parsed);
  return result.success ? { status: 'ok', document: result.data } : { status: 'invalid' };
}
