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

export const globToolDefinition: ToolDefinition = {
  name: 'glob',
  title: 'Find files',
  description: 'Find files matching a glob pattern without reading file content.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern.' },
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
  capabilities: ['project_read'],
  riskLevel: 'low',
  sideEffect: 'none',
  availability: { status: 'available' },
  executionMode: 'parallel',
  permissionMetadata: { ruleToolName: 'glob' },
  modelFacingDescription: 'Find files matching a glob pattern without reading file content.',
};

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
  const files = await withFileFailure('glob', () => (
    context.workspaceFileAccess.walkFiles({ path: cwd, includeHidden, signal })
  ));
  const matcher = globToRegExp(pattern);
  const matches = files.filter((file) => matcher.test(normalizeSlash(file))).sort();

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
    source += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }
  return new RegExp(`${source}$`);
}

function globStaticBase(pattern: string): string {
  const normalized = normalizeSlash(pattern);
  const staticSegments: string[] = [];
  for (const segment of normalized.split('/')) {
    if (segment.includes('*')) {
      break;
    }
    staticSegments.push(segment);
  }
  return staticSegments.join('/') || '.';
}
