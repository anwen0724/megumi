/* Finds workspace files whose normalized paths match a glob pattern. */
import type { RawToolResult } from '../contracts/tool-contracts';
import { buildBoundedItemPage } from './bounded-page';
import {
  inputRecord,
  optionalBoolean,
  optionalNonNegativeInteger,
  optionalPositiveInteger,
  optionalString,
  requireString,
} from './input';
import type { BuiltInToolContext } from './types';
import { withFileFailure } from './file-failure';

export async function executeGlob(
  context: BuiltInToolContext,
  input: unknown,
): Promise<RawToolResult> {
  const record = inputRecord(input);
  const pattern = requireString(record, 'pattern');
  const cwd = optionalString(record, 'cwd', globStaticBase(pattern));
  const limit = optionalPositiveInteger(record, 'limit', 500);
  const offset = optionalNonNegativeInteger(record, 'offset', 0);
  const includeHidden = optionalBoolean(record, 'includeHidden', false);
  const files = await withFileFailure('glob', () => (
    context.workspaceFileAccess.walkFiles({ path: cwd, includeHidden })
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
