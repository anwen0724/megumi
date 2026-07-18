/* Reads a bounded text file from the active workspace. */
import type { RawToolResult } from '../contracts/tool-contracts';
import { inputRecord, optionalPositiveInteger, requireString } from './input';
import type { BuiltInToolContext } from './types';

export async function executeReadFile(
  context: BuiltInToolContext,
  input: unknown,
): Promise<RawToolResult> {
  const record = inputRecord(input);
  const targetPath = requireString(record, 'path');
  const maxBytes = optionalPositiveInteger(record, 'maxBytes', 256 * 1024);
  const result = await context.workspaceFileAccess.readFile({ path: targetPath, maxBytes });

  return {
    outputKind: 'file',
    content: result.content,
    metadata: {
      path: result.path,
      truncated: result.truncated,
      sizeBytes: result.sizeBytes,
    },
  };
}
