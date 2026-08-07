/* Moves or renames one file or directory inside the active Workspace. */
import type { RawToolResult, ToolDefinition } from '../tool';
import { inputRecord, optionalBoolean, requireString } from './tool-input';
import { toolEffectPath, withFileFailure, type BuiltInToolContext } from './workspace-file-access';
import { createBuiltInToolHandler, inputString, operation } from './tool-handler';

export const movePathToolDefinition: ToolDefinition = {
  name: 'move_path', description: 'Move or rename a file or directory.',
  promptSnippet: 'Move or rename a file or directory.',
  parameters: { type: 'object', properties: { source: { type: 'string', description: 'Source path.' }, destination: { type: 'string', description: 'Destination path.' }, overwrite: { type: 'boolean', description: 'Replace an existing destination.' } }, required: ['source', 'destination'], additionalProperties: false },
  annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
};
export const movePathToolHandler = createBuiltInToolHandler({
  toolName: 'move_path',
  operations: (invocation) => [
    operation(invocation, 'workspace.write', { type: 'workspace.path', id: inputString(invocation, 'source') }),
    operation(invocation, 'workspace.write', { type: 'workspace.path', id: inputString(invocation, 'destination') }),
  ],
  execute: (context, input, options) => executeMovePath(context, input, options.signal),
});

export async function executeMovePath(context: BuiltInToolContext, input: unknown, signal?: AbortSignal): Promise<RawToolResult> {
  const record = inputRecord(input);
  const result = await withFileFailure('move', () => context.workspaceFileAccess.movePath({ source: requireString(record, 'source'), destination: requireString(record, 'destination'), overwrite: optionalBoolean(record, 'overwrite', false), signal }));
  return { outputKind: 'json', content: result, effectReport: { coverage: 'complete', effects: [{ type: 'moved', source: toolEffectPath(result.source), destination: toolEffectPath(result.destination), pathType: result.pathType }], itemFailures: [] } };
}
