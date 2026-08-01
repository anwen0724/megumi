/* Reads a bounded text file from the active workspace. */
import type { RawToolResult, ToolDefinition } from '../tool';
import { MAX_NORMALIZED_CONTENT_BYTES } from '../tool-result';
import { fitsNormalizedJson, serializedBytes } from './bounded-page';
import { extractFileText } from './document-text';
import { inputRecord, optionalNonNegativeInteger, optionalPositiveInteger, requireString } from './tool-input';
import { withFileFailure, type BuiltInToolContext } from './workspace-file-access';

export const readFileToolDefinition: ToolDefinition = {
  name: 'read_file',
  title: 'Read file',
  description: 'Read a bounded UTF-8 text page from a text, Markdown, DOCX, or PDF file. Continue with nextOffset when hasMore is true.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The file to read. Relative paths are resolved from the current working directory.',
      },
      offset: { type: 'integer', minimum: 0, description: 'UTF-8 byte offset. Defaults to 0.' },
      limit: { type: 'integer', minimum: 1, description: 'Maximum UTF-8 content bytes requested for this page.' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      content: { type: 'string' }, path: { type: 'string' }, offset: { type: 'integer' },
      bytesReturned: { type: 'integer' }, sizeBytes: { type: 'integer' },
      hasMore: { type: 'boolean' }, nextOffset: { type: 'integer' },
    },
    required: ['path', 'content', 'offset', 'bytesReturned', 'sizeBytes', 'hasMore'],
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  capabilities: ['project_read'],
  riskLevel: 'low',
  sideEffect: 'none',
  availability: { status: 'available' },
  executionMode: 'parallel',
  permissionMetadata: { ruleToolName: 'read_file' },
  modelFacingDescription: 'Read a bounded text page from a text, Markdown, DOCX, or PDF file. If hasMore is true, call read_file again with nextOffset.',
};

export async function executeReadFile(
  context: BuiltInToolContext,
  input: unknown,
  signal?: AbortSignal,
): Promise<RawToolResult> {
  const record = inputRecord(input);
  const targetPath = requireString(record, 'path');
  const offset = optionalNonNegativeInteger(record, 'offset', 0);
  const limit = optionalPositiveInteger(record, 'limit', MAX_NORMALIZED_CONTENT_BYTES);
  const result = await withFileFailure('read', () => (
    extractFileText(context.workspaceFileAccess, targetPath, signal)
  ));
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
