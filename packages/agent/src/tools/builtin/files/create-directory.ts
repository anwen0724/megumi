/* Creates one directory inside the active Workspace. */
import { fileContext } from '../../../sandbox/file-access';
import type { BuiltInToolContext } from '../../tool-contracts';
import type { RawToolResult, AgentTool } from '../../tool-contracts';
import { inputRecord, optionalBoolean, requireString } from '../../tool-input';
import { toolEffectPath, withFileFailure } from '../../../sandbox/file-access';

export const createDirectoryTool: AgentTool = {
  name: 'create_directory', description: 'Create a directory.',
  promptSnippet: 'Create a directory.',
  parameters: { type: 'object', properties: { path: { type: 'string', description: 'Directory path.' }, recursive: { type: 'boolean', description: 'Create missing parent directories.' } }, required: ['path'], additionalProperties: false },
  annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
  executionMode: 'serial',
  operations: (input) => [{ action: 'workspace.write', resource: { type: 'workspace.path', id: requireString(inputRecord(input), 'path') } }],
  execute: (input, execution) => executeCreateDirectory(fileContext(execution), input, execution.signal),
};

/** Executes the validated built-in operation within its supplied access scope. */
async function executeCreateDirectory(context: BuiltInToolContext, input: unknown, signal?: AbortSignal): Promise<RawToolResult> {
  const record = inputRecord(input);
  const result = await withFileFailure('create_directory', () => context.workspaceFileAccess.createDirectory({ path: requireString(record, 'path'), recursive: optionalBoolean(record, 'recursive', false), signal }));
  return { outputKind: 'json', content: result, effectReport: { coverage: 'complete', effects: result.created ? [{ type: 'created', path: toolEffectPath(result.path), pathType: 'directory' }] : [], itemFailures: [] } };
}
