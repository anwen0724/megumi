/* Builds resumable tool-result pages that fit the shared model-content byte boundary. */
import { normalizeRawToolContent } from '../core/tool-execution-result';

export type PageFields = {
  offset: number;
  hasMore: boolean;
  nextOffset?: number;
};

export function buildBoundedItemPage<T, TResult extends object>(input: {
  items: readonly T[];
  offset: number;
  limit: number;
  contentFor: (items: T[], page: PageFields) => TResult;
}): TResult {
  const available = input.items.slice(input.offset, input.offset + input.limit);
  for (let count = available.length; count >= 0; count -= 1) {
    const nextOffset = input.offset + count;
    const page: PageFields = {
      offset: input.offset,
      hasMore: nextOffset < input.items.length,
      ...(nextOffset < input.items.length && count > 0 ? { nextOffset } : {}),
    };
    const content = input.contentFor(available.slice(0, count), page);
    if (fitsNormalizedJson(content)) {
      if (count === 0 && input.offset < input.items.length) {
        throw new Error('A single tool result item exceeds the model content safety limit.');
      }
      return content;
    }
  }
  throw new Error('Unable to build a bounded tool result page.');
}

export function serializedBytes(content: unknown): number {
  return Buffer.byteLength(JSON.stringify(content, null, 2), 'utf8');
}

export function fitsNormalizedJson(content: unknown): boolean {
  return !normalizeRawToolContent({ outputKind: 'json', content }).truncated;
}
