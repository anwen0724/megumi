/* Searches text across readable files inside the active workspace. */
import type { RawToolResult } from '../contracts/tool-contracts';
import { inputRecord, optionalPositiveInteger, optionalString, requireString } from './input';
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
      if (matches.length >= limit) {
        return { outputKind: 'json', content: { matches, truncated: true } };
      }
    }
  }

  return { outputKind: 'json', content: { matches, truncated: false } };
}
