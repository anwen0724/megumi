/* Searches text across readable files inside the active workspace. */
import type { RawToolResult } from '../contracts/tool-contracts';
import { buildBoundedItemPage } from './bounded-page';
import {
  inputRecord,
  optionalNonNegativeInteger,
  optionalPositiveInteger,
  optionalString,
  requireString,
} from './input';
import type { BuiltInToolContext } from './types';

export async function executeSearchText(
  context: BuiltInToolContext,
  input: unknown,
): Promise<RawToolResult> {
  const record = inputRecord(input);
  const query = requireString(record, 'query');
  const rootPath = optionalString(record, 'path', '.');
  const caseSensitive = Boolean(record.caseSensitive);
  const limit = optionalPositiveInteger(record, 'limit', 100);
  const offset = optionalNonNegativeInteger(record, 'offset', 0);
  const files = await context.workspaceFileAccess.walkFiles({ path: rootPath });
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: Array<{ path: string; line: number; preview: string }> = [];

  for (const file of files) {
    const content = await context.workspaceFileAccess.readTextFile({ path: file });
    for (const [index, line] of content.split(/\r?\n/).entries()) {
      const haystack = caseSensitive ? line : line.toLowerCase();
      if (haystack.includes(needle)) {
        matches.push({ path: file, line: index + 1, preview: line.slice(0, 500) });
      }
    }
  }

  matches.sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line);
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
