/* Recoverably deletes one file or directory inside the active Workspace. */
import { fileContext } from '../../../sandbox/file-access';
import type { BuiltInToolContext } from '../../tool-contracts';
import type { RawToolResult, AgentTool } from '../../tool-contracts';
import { inputRecord, optionalBoolean, requireString } from '../../tool-input';
import { toolEffectPath, withFileFailure } from '../../../sandbox/file-access';

export const deletePathTool: AgentTool = {
  name: 'delete_path', description: 'Move a file or directory to a recoverable Workspace location. Deleted paths can be restored.',
  promptSnippet: 'Move a file or directory to a recoverable location.',
  parameters: { type: 'object', properties: { path: { type: 'string', description: 'Path to delete.' }, recursive: { type: 'boolean', description: 'Allow a non-empty directory.' } }, required: ['path'], additionalProperties: false },
  annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
  executionMode: 'serial',
  operations: (input) => [{ action: 'workspace.write', resource: { type: 'workspace.path', id: requireString(inputRecord(input), 'path') } }],
  execute: (input, execution) => executeDeletePath(fileContext(execution), input, execution.signal),
};

/** Executes the validated built-in operation within its supplied access scope. */
async function executeDeletePath(context: BuiltInToolContext, input: unknown, signal?: AbortSignal): Promise<RawToolResult> {
  const record = inputRecord(input);
  const result = await withFileFailure('delete', () => context.workspaceFileAccess.deletePath({ path: requireString(record, 'path'), recursive: optionalBoolean(record, 'recursive', false), signal }));
  return { outputKind: 'json', content: result, effectReport: { coverage: 'complete', effects: [{ type: 'deleted', path: toolEffectPath(result.path), pathType: result.pathType, recoverable: true }], itemFailures: [] } };
}
