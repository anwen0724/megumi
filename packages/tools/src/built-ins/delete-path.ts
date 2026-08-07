/* Recoverably deletes one file or directory inside the active Workspace. */
import type { RawToolResult, ToolDefinition } from '../tool';
import { inputRecord, optionalBoolean, requireString } from './tool-input';
import { toolEffectPath, withFileFailure, type BuiltInToolContext } from './workspace-file-access';
import { createBuiltInToolHandler, inputString, operation } from './tool-handler';

export const deletePathToolDefinition: ToolDefinition = {
  name: 'delete_path', description: 'Move a file or directory to a recoverable Workspace location. Deleted paths can be restored.',
  promptSnippet: 'Move a file or directory to a recoverable location.',
  parameters: { type: 'object', properties: { path: { type: 'string', description: 'Path to delete.' }, recursive: { type: 'boolean', description: 'Allow a non-empty directory.' } }, required: ['path'], additionalProperties: false },
  annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
};
export const deletePathToolHandler = createBuiltInToolHandler({
  toolName: 'delete_path',
  operations: (invocation) => [operation(invocation, 'workspace.write', { type: 'workspace.path', id: inputString(invocation, 'path') })],
  execute: (context, input, options) => executeDeletePath(context, input, options.signal),
});

export async function executeDeletePath(context: BuiltInToolContext, input: unknown, signal?: AbortSignal): Promise<RawToolResult> {
  const record = inputRecord(input);
  const result = await withFileFailure('delete', () => context.workspaceFileAccess.deletePath({ path: requireString(record, 'path'), recursive: optionalBoolean(record, 'recursive', false), signal }));
  return { outputKind: 'json', content: result, effectReport: { coverage: 'complete', effects: [{ type: 'deleted', path: toolEffectPath(result.path), pathType: result.pathType, recoverable: true }], itemFailures: [] } };
}
