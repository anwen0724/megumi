/* Finds workspace files whose normalized paths match a glob pattern. */
import type { RawToolResult, ToolDefinition } from '../tool';
import { buildBoundedItemPage } from './bounded-page';
import {
  inputRecord,
  optionalBoolean,
  optionalNonNegativeInteger,
  optionalPositiveInteger,
  optionalString,
  requireString,
} from './tool-input';
import { withFileFailure, type BuiltInToolContext } from './workspace-file-access';
import { createBuiltInToolHandler, inputString, operation } from './tool-handler';

export const globToolDefinition: ToolDefinition = {
  name: 'glob',
  description: 'Find files matching a glob pattern without reading file content.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern using *, **, ?, or character sets.' },
      cwd: {
        type: 'string',
        description: 'The directory to search from. Relative paths are resolved from the current working directory.',
      },
      limit: { type: 'integer', description: 'Optional maximum number of matches.' },
      includeHidden: { type: 'boolean', description: 'Whether hidden files should be included.' },
      offset: { type: 'integer', minimum: 0, description: 'Match offset. Defaults to 0.' },
    },
    required: ['pattern'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      matches: { type: 'array', items: { type: 'string' } }, offset: { type: 'integer' },
      hasMore: { type: 'boolean' }, nextOffset: { type: 'integer' },
    },
    required: ['matches', 'offset', 'hasMore'],
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
};

export const globToolHandler = createBuiltInToolHandler({
  toolName: 'glob',
  operations: (invocation) => [operation(invocation, 'workspace.read', {
    type: 'workspace.path', id: inputString(invocation, 'cwd', '.'),
  })],
  execute: (context, input, options) => executeGlob(context, input, options.signal),
});

export async function executeGlob(
  context: BuiltInToolContext,
  input: unknown,
  signal?: AbortSignal,
): Promise<RawToolResult> {
  const record = inputRecord(input);
  const pattern = requireString(record, 'pattern');
  const cwd = optionalString(record, 'cwd', globStaticBase(pattern));
  const limit = optionalPositiveInteger(record, 'limit', 500);
  const offset = optionalNonNegativeInteger(record, 'offset', 0);
  const includeHidden = optionalBoolean(record, 'includeHidden', false);
  const traversal = await withFileFailure('glob', () => (
    context.workspaceFileAccess.walkFiles({ path: cwd, includeHidden, signal })
  ));
  const matcher = globToRegExp(pattern);
  const matches = traversal.files.filter((file) => matcher.test(normalizeSlash(file))).sort();

  return {
    outputKind: 'json',
    content: buildBoundedItemPage({
      items: matches,
      offset,
      limit,
      contentFor: (pageMatches, page) => ({
        matches: pageMatches, ...page,
        scannedFileCount: traversal.scannedFileCount,
        skippedCount: traversal.skippedCount,
        limitReached: traversal.limitReached,
        warnings: traversal.warnings,
      }),
    }),
  };
}

function normalizeSlash(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\/+/, '') || '.';
}

function globToRegExp(pattern: string): RegExp {
  const normalized = normalizeSlash(pattern);
  let source = '^';
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];
    if (char === '*' && next === '*') {
      if (normalized[index + 2] === '/') {
        source += '(?:.*/)?';
        index += 2;
        continue;
      }
      source += '.*';
      index += 1;
      continue;
    }
    if (char === '*') {
      source += '[^/]*';
      continue;
    }
    if (char === '?') {
      source += '[^/]';
      continue;
    }
    if (char === '[') {
      const closing = normalized.indexOf(']', index + 1);
      if (closing < 0) throw new TypeError('Invalid glob pattern: unclosed character set.');
      const body = normalized.slice(index + 1, closing);
      if (!body || body.includes('/')) throw new TypeError('Invalid glob character set.');
      source += '[' + body.replace(/\\/g, '\\\\') + ']';
      index = closing;
      continue;
    }
    source += char.replace(/[|\\{}()[\]^$+.]/g, '\\$&');
  }
  return new RegExp(`${source}$`);
}

function globStaticBase(pattern: string): string {
  const normalized = normalizeSlash(pattern);
  const staticSegments: string[] = [];
  for (const segment of normalized.split('/')) {
    if (/[*?\[]/.test(segment)) {
      break;
    }
    staticSegments.push(segment);
  }
  return staticSegments.join('/') || '.';
}
