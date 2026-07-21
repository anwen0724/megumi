/* Reads a bounded text file from the active workspace. */
import type { RawToolResult } from '../contracts/tool-contracts';
import { MAX_NORMALIZED_CONTENT_BYTES } from '../core/tool-execution-result';
import { fitsNormalizedJson, serializedBytes } from './bounded-page';
import { inputRecord, optionalNonNegativeInteger, optionalPositiveInteger, requireString } from './input';
import type { BuiltInToolContext } from './types';
import { withFileFailure } from './file-failure';

export async function executeReadFile(
  context: BuiltInToolContext,
  input: unknown,
): Promise<RawToolResult> {
  const record = inputRecord(input);
  const targetPath = requireString(record, 'path');
  const offset = optionalNonNegativeInteger(record, 'offset', 0);
  const limit = optionalPositiveInteger(record, 'limit', MAX_NORMALIZED_CONTENT_BYTES);
  const result = await withFileFailure('read', () => context.workspaceFileAccess.readFile({ path: targetPath }));
  const content = buildReadPage({ ...result, offset, limit });

  return {
    outputKind: 'json',
    content,
  };
}

function buildReadPage(input: {
  path: string;
  content: string;
  sizeBytes: number;
  offset: number;
  limit: number;
}) {
  const source = Buffer.from(input.content, 'utf8');
  if (input.offset > source.byteLength) {
    throw new Error(`read_file offset ${input.offset} exceeds file size ${source.byteLength}.`);
  }
  if (!isUtf8Boundary(source, input.offset)) {
    throw new Error(`read_file offset ${input.offset} is not a UTF-8 character boundary.`);
  }

  let end = Math.min(source.byteLength, input.offset + input.limit);
  while (!isUtf8Boundary(source, end)) end -= 1;

  while (end >= input.offset) {
    const content = source.subarray(input.offset, end).toString('utf8');
    const bytesReturned = end - input.offset;
    const hasMore = end < source.byteLength;
    const result = {
      path: input.path,
      content,
      offset: input.offset,
      bytesReturned,
      sizeBytes: input.sizeBytes,
      hasMore,
      ...(hasMore && bytesReturned > 0 ? { nextOffset: end } : {}),
    };
    const excess = serializedBytes(result) - MAX_NORMALIZED_CONTENT_BYTES;
    if (excess <= 0 && fitsNormalizedJson(result)) {
      if (bytesReturned === 0 && hasMore) {
        throw new Error('read_file cannot fit one UTF-8 character inside the model content safety limit.');
      }
      return result;
    }
    end = Math.max(input.offset, end - Math.max(1, excess));
    while (!isUtf8Boundary(source, end)) end -= 1;
  }

  throw new Error('Unable to build a bounded read_file result.');
}

function isUtf8Boundary(content: Buffer, offset: number): boolean {
  return offset === 0
    || offset === content.byteLength
    || (content[offset] & 0xC0) !== 0x80;
}
