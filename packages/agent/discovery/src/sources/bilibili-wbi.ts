/*
 * Implements Bilibili's public WBI parameter signing without cookies or account state.
 */
import { createHash } from 'node:crypto';

const MIXIN_KEY_INDEXES = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
] as const;

type WbiParameter = string | number | boolean;

/** Signs one Bilibili WBI query using the current navigation image keys. */
export function signBilibiliWbiParameters(input: {
  readonly params: Readonly<Record<string, WbiParameter>>;
  readonly imgKey: string;
  readonly subKey: string;
  readonly timestampSeconds: number;
}): Record<string, string> {
  const sourceKey = input.imgKey + input.subKey;
  const mixinKey = MIXIN_KEY_INDEXES.map((index) => sourceKey[index] ?? '').join('').slice(0, 32);
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...input.params, wts: Math.floor(input.timestampSeconds) })) {
    values[key] = String(value).replace(/[!'()*]/g, '');
  }
  const sorted = Object.fromEntries(Object.entries(values).sort(([left], [right]) => left.localeCompare(right)));
  const query = new URLSearchParams(sorted).toString();
  return {
    ...sorted,
    w_rid: createHash('md5').update(query + mixinKey).digest('hex'),
  };
}
