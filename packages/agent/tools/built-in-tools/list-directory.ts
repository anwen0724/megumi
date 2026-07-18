/* Lists direct entries from a directory inside the active workspace. */
import type { RawToolResult } from '../contracts/tool-contracts';
import { inputRecord, optionalString } from './input';
import type { BuiltInToolContext } from './types';

export async function executeListDirectory(
  context: BuiltInToolContext,
  input: unknown,
): Promise<RawToolResult> {
  const record = inputRecord(input);
  const requestedPath = optionalString(record, 'path', '.');
  const result = await context.workspaceFileAccess.listDirectory({ path: requestedPath });

  return {
    outputKind: 'json',
    content: {
      path: result.path,
      entries: result.entries,
      truncated: result.truncated,
    },
  };
}
