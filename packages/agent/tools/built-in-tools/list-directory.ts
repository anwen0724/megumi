/* Lists direct entries from a directory inside the active workspace. */
import type { RawToolResult } from '../contracts/tool-contracts';
import { buildBoundedItemPage } from './bounded-page';
import {
  inputRecord,
  optionalBoolean,
  optionalNonNegativeInteger,
  optionalPositiveInteger,
  optionalString,
} from './input';
import type { BuiltInToolContext } from './types';
import { withFileFailure } from './file-failure';

export async function executeListDirectory(
  context: BuiltInToolContext,
  input: unknown,
): Promise<RawToolResult> {
  const record = inputRecord(input);
  const requestedPath = optionalString(record, 'path', '.');
  const maxDepth = optionalPositiveInteger(record, 'maxDepth', 1);
  const limit = optionalPositiveInteger(record, 'limit', 100);
  const includeHidden = optionalBoolean(record, 'includeHidden', false);
  const offset = optionalNonNegativeInteger(record, 'offset', 0);
  const result = await withFileFailure('list', () => context.workspaceFileAccess.listDirectory({
    path: requestedPath,
    maxDepth,
    includeHidden,
  }));

  return {
    outputKind: 'json',
    content: buildBoundedItemPage({
      items: result.entries,
      offset,
      limit,
      contentFor: (entries, page) => ({ path: result.path, entries, ...page }),
    }),
  };
}
