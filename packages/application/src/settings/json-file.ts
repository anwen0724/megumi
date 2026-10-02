/* Reads JSON documents without side effects for configuration and credentials. */
import fs from 'node:fs';
import { z } from 'zod';

const DocumentSchema = z.record(z.unknown());

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
