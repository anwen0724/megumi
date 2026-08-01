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

export const searchTextToolDefinition: ToolDefinition = {
  name: 'search_text',
  title: 'Search text',
  description: 'Search text in readable files, including Markdown, DOCX, and PDF, and return size-limited matches.',
  inputSchema: {
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
  capabilities: ['project_read'],
  riskLevel: 'low',
  sideEffect: 'none',
  availability: { status: 'available' },
  executionMode: 'parallel',
  permissionMetadata: { ruleToolName: 'search_text' },
  modelFacingDescription: 'Search text in files, including Markdown, DOCX, and PDF, and return size-limited matches with line or PDF page locations.',
};

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
  const files = await withFileFailure('search', () => (
    context.workspaceFileAccess.walkFiles({ path: rootPath, signal })
  ));
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: Array<{ path: string; line: number; page?: number; preview: string }> = [];

  for (const file of files) {
    signal?.throwIfAborted();
    const extracted = await withFileFailure('search', () => (
      extractFileText(context.workspaceFileAccess, file, signal)
    ));
    let currentPage: number | undefined;
    for (const [index, line] of extracted.content.split(/\r?\n/).entries()) {
      const pageMarker = /^\[Page (\d+)]$/.exec(line);
      if (pageMarker) {
        currentPage = Number(pageMarker[1]);
        continue;
      }
      const haystack = caseSensitive ? line : line.toLowerCase();
      if (haystack.includes(needle)) {
        matches.push({
          path: extracted.path,
          line: index + 1,
          ...(currentPage !== undefined ? { page: currentPage } : {}),
          preview: line.slice(0, 500),
        });
      }
    }
  }

  matches.sort((left, right) => compareStableText(left.path, right.path) || left.line - right.line);
  return {
    outputKind: 'json',
    content: buildBoundedItemPage({
      items: matches,
      offset,
      limit,
      contentFor: (pageMatches, page) => ({ matches: pageMatches, ...page }),
    }),
  };
}

function compareStableText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
