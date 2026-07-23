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
import { withFileFailure } from './file-failure';
import { extractFileText } from './document-text-extractor';

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
  const files = await withFileFailure('search', () => context.workspaceFileAccess.walkFiles({ path: rootPath }));
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: Array<{ path: string; line: number; page?: number; preview: string }> = [];

  for (const file of files) {
    const extracted = await withFileFailure('search', () => extractFileText(context.workspaceFileAccess, file));
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
