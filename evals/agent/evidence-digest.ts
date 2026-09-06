/* Computes canonical JSON identities shared by execution records and offline scoring. */
import { createHash } from 'node:crypto';

/** Hashes JSON with stable object key order. */
export function digest(value: unknown): string { return createHash('sha256').update(canonicalJson(value)).digest('hex'); }

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ':' + canonicalJson(item)).join(',') + '}';
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('Digest input must be JSON.');
  return serialized;
}
