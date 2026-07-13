/* Finds workspace files whose normalized paths match a glob pattern. */
import type { RawToolResult } from '../contracts/tool-contracts';
import { inputRecord, optionalPositiveInteger, optionalString, requireString } from './input';
import type { BuiltInToolContext } from './types';

export async function executeGlob(
  context: BuiltInToolContext,
  input: unknown,
): Promise<RawToolResult> {
  const record = inputRecord(input);
  const pattern = requireString(record, 'pattern');
  const cwd = optionalString(record, 'cwd', globStaticBase(pattern));
  const limit = optionalPositiveInteger(record, 'limit', 500);
  const files = await context.workspaceFileAccess.walkFiles({ path: cwd });
  const matcher = globToRegExp(pattern);
  const matches = files.filter((file) => matcher.test(normalizeSlash(file))).slice(0, limit);

  return {
    outputKind: 'json',
    content: {
      matches,
      truncated: files.length > matches.length,
    },
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
