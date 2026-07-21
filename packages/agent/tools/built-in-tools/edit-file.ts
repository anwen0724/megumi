/* Applies an exact text replacement to an existing workspace file. */
import type { RawToolResult } from '../contracts/tool-contracts';
import { inputRecord, requireString } from './input';
import type { BuiltInToolContext } from './types';
import { withFileFailure } from './file-failure';

export async function executeEditFile(
  context: BuiltInToolContext,
  input: unknown,
): Promise<RawToolResult> {
  const record = inputRecord(input);
  const result = await withFileFailure('edit', () => context.workspaceFileAccess.replaceText({
    path: requireString(record, 'path'),
    oldText: requireString(record, 'oldText'),
    newText: requireString(record, 'newText'),
    replaceAll: Boolean(record.replaceAll),
  }));

  return {
    outputKind: 'json',
    content: {
      path: result.path,
      replacements: result.replacements,
      changed: result.changed,
    },
  };
}
