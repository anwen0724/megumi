/* Searches text across readable files inside the active workspace. */
import type { RawToolResult, ToolDefinition } from '../tool';
import { buildBoundedItemPage } from './bounded-page';
import {
  inputRecord,
  optionalNonNegativeInteger,
  optionalPositiveInteger,
  optionalString,
  requireString,
} from './tool-input';
import { extractFileText } from './document-text';
import { withFileFailure, type BuiltInToolContext } from './workspace-file-access';
import { createBuiltInToolHandler, inputString, operation } from './tool-handler';

export const searchTextToolDefinition: ToolDefinition = {
  name: 'search_text',
  description: 'Search text in readable files, including Markdown, DOCX, and PDF, and return size-limited matches.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Literal text to search for.' },
      path: {
        type: 'string',
        description: 'The path to search in. Relative paths are resolved from the current working directory.',
      },
      caseSensitive: { type: 'boolean', description: 'Whether matching is case-sensitive.' },
      limit: { type: 'integer', description: 'Optional maximum number of matches.' },
      offset: { type: 'integer', minimum: 0, description: 'Match offset. Defaults to 0.' },
    },
    required: ['query'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      matches: { type: 'array', items: { type: 'object', properties: {
        path: { type: 'string' }, line: { type: 'integer' }, page: { type: 'integer' }, preview: { type: 'string' },
      } } },
      offset: { type: 'integer' }, hasMore: { type: 'boolean' }, nextOffset: { type: 'integer' },
    },
    required: ['matches', 'offset', 'hasMore'],
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
};

export const searchTextToolHandler = createBuiltInToolHandler({
  toolName: 'search_text',
  operations: (invocation) => [operation(invocation, 'workspace.read', {
    type: 'workspace.path', id: inputString(invocation, 'path', '.'),
  })],
  execute: (context, input, options) => executeSearchText(context, input, options.signal),
});

export async function executeSearchText(
  context: BuiltInToolContext,
  input: unknown,
  signal?: AbortSignal,
): Promise<RawToolResult> {
  const record = inputRecord(input);
  const query = requireString(record, 'query');
  const rootPath = optionalString(record, 'path', '.');
  const caseSensitive = Boolean(record.caseSensitive);
  const limit = optionalPositiveInteger(record, 'limit', 100);
  const offset = optionalNonNegativeInteger(record, 'offset', 0);
  const traversal = await withFileFailure('search', () => (
    context.workspaceFileAccess.walkFiles({ path: rootPath, signal })
  ));
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: Array<{ path: string; line: number; page?: number; preview: string }> = [];
  const warnings = [...traversal.warnings];
  const startedAt = Date.now();
  const maxTotalBytes = 50_000_000;
  const maxFileBytes = 5_000_000;
  const targetMatchCount = offset + limit + 1;
  let totalReadBytes = 0;
  let limitReached = traversal.limitReached;

  files: for (const file of traversal.files) {
    signal?.throwIfAborted();
    if (Date.now() - startedAt > 30_000) { limitReached = true; break; }
    let extracted;
    try { extracted = await extractFileText(context.workspaceFileAccess, file, signal); }
    catch {
      signal?.throwIfAborted();
      warnings.push({ path: file, code: 'file_unreadable', message: 'The file could not be searched.' });
      continue;
    }
    const fileBytes = Buffer.byteLength(extracted.content, 'utf8');
    if (fileBytes > maxFileBytes || totalReadBytes + fileBytes > maxTotalBytes) {
      warnings.push({ path: file, code: 'read_limit', message: 'The file was skipped because the search read limit was reached.' });
      limitReached = true;
      if (totalReadBytes + fileBytes > maxTotalBytes) break;
      continue;
    }
    totalReadBytes += fileBytes;
    let currentPage: number | undefined;
    for (const [index, line] of extracted.content.split(/\r?\n/).entries()) {
      const pageMarker = /^\[Page (\d+)]$/.exec(line);
      if (pageMarker) { currentPage = Number(pageMarker[1]); continue; }
      const haystack = caseSensitive ? line : line.toLowerCase();
      if (!haystack.includes(needle)) continue;
      matches.push({
        path: extracted.path,
        line: index + 1,
        ...(currentPage !== undefined ? { page: currentPage } : {}),
        preview: line.slice(0, 500),
      });
      if (matches.length >= targetMatchCount) { limitReached = true; break files; }
    }
  }
  matches.sort((left, right) => compareStableText(left.path, right.path) || left.line - right.line);
  return {
    outputKind: 'json',
    content: buildBoundedItemPage({
      items: matches,
      offset,
      limit,
      contentFor: (pageMatches, page) => ({
        matches: pageMatches, ...page,
        scannedFileCount: traversal.scannedFileCount,
        skippedCount: traversal.skippedCount + warnings.length - traversal.warnings.length,
        totalReadBytes,
        limitReached,
        warnings: warnings.slice(0, 100),
      }),
    }),
  };
}

function compareStableText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
