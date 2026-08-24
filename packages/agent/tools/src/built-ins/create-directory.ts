/* Creates one directory inside the active Workspace. */
import type { RawToolResult, ToolDefinition } from '../tool';
import { inputRecord, optionalBoolean, requireString } from './tool-input';
import { toolEffectPath, withFileFailure, type BuiltInToolContext } from './workspace-file-access';
import { createBuiltInToolHandler, inputString, operation } from './tool-handler';

export const createDirectoryToolDefinition: ToolDefinition = {
  name: 'create_directory', description: 'Create a directory.',
  promptSnippet: 'Create a directory.',
  parameters: { type: 'object', properties: { path: { type: 'string', description: 'Directory path.' }, recursive: { type: 'boolean', description: 'Create missing parent directories.' } }, required: ['path'], additionalProperties: false },
  annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
};
export const createDirectoryToolHandler = createBuiltInToolHandler({
  toolName: 'create_directory',
  operations: (invocation) => [operation(invocation, 'workspace.write', { type: 'workspace.path', id: inputString(invocation, 'path') })],
  execute: (context, input, options) => executeCreateDirectory(context, input, options.signal),
});

export async function executeCreateDirectory(context: BuiltInToolContext, input: unknown, signal?: AbortSignal): Promise<RawToolResult> {
  const record = inputRecord(input);
  const result = await withFileFailure('create_directory', () => context.workspaceFileAccess.createDirectory({ path: requireString(record, 'path'), recursive: optionalBoolean(record, 'recursive', false), signal }));
  return { outputKind: 'json', content: result, effectReport: { coverage: 'complete', effects: result.created ? [{ type: 'created', path: toolEffectPath(result.path), pathType: 'directory' }] : [], itemFailures: [] } };
}
