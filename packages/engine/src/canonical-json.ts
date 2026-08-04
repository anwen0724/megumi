/*
 * Canonical JSON serialization for stable fingerprints and tool-input projection:
 * object keys are sorted, Uint8Array becomes a stable {$bytes} shape, and values
 * that JSON cannot represent map to null instead of silently dropping keys.
 */

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function canonicalValue(value: unknown): unknown {
  if (value instanceof Uint8Array) return { $bytes: [...value] };
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
  ) {
    return value;
  }
  return null;
}
