/* Creates or overwrites a text file inside the active workspace. */
import type { RawToolResult } from '../contracts/tool-contracts';
import { inputRecord, requireString } from './input';
import type { BuiltInToolContext } from './types';
import { withFileFailure } from './file-failure';

export async function executeWriteFile(
  context: BuiltInToolContext,
  input: unknown,
): Promise<RawToolResult> {
  const record = inputRecord(input);
  const result = await withFileFailure('write', () => context.workspaceFileAccess.writeFile({
    path: requireString(record, 'path'),
    content: requireString(record, 'content'),
    overwrite: Boolean(record.overwrite),
  }));

  return {
    outputKind: 'json',
    content: {
      path: result.path,
      bytesWritten: result.bytesWritten,
      created: result.created,
      overwritten: result.overwritten,
    },
  };
}
