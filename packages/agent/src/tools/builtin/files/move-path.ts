/* Moves or renames one file or directory inside the active Workspace. */
import { fileContext } from '../../../sandbox/file-access';
import type { BuiltInToolContext } from '../../tool-contracts';
import type { RawToolResult, AgentTool } from '../../tool-contracts';
import { inputRecord, optionalBoolean, requireString } from '../../tool-input';
import { toolEffectPath, withFileFailure } from '../../../sandbox/file-access';

export const movePathTool: AgentTool = {
  name: 'move_path', description: 'Move or rename a file or directory.',
  promptSnippet: 'Move or rename a file or directory.',
  parameters: { type: 'object', properties: { source: { type: 'string', description: 'Source path.' }, destination: { type: 'string', description: 'Destination path.' }, overwrite: { type: 'boolean', description: 'Replace an existing destination.' } }, required: ['source', 'destination'], additionalProperties: false },
  annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
  executionMode: 'serial',
  operations: (input) => [
    { action: 'workspace.write', resource: { type: 'workspace.path', id: requireString(inputRecord(input), 'source') } },
    { action: 'workspace.write', resource: { type: 'workspace.path', id: requireString(inputRecord(input), 'destination') } },
  ],
  execute: (input, execution) => executeMovePath(fileContext(execution), input, execution.signal),
};

/** Executes the validated built-in operation within its supplied access scope. */
async function executeMovePath(context: BuiltInToolContext, input: unknown, signal?: AbortSignal): Promise<RawToolResult> {
  const record = inputRecord(input);
  const result = await withFileFailure('move', () => context.workspaceFileAccess.movePath({ source: requireString(record, 'source'), destination: requireString(record, 'destination'), overwrite: optionalBoolean(record, 'overwrite', false), signal }));
  return { outputKind: 'json', content: result, effectReport: { coverage: 'complete', effects: [{ type: 'moved', source: toolEffectPath(result.source), destination: toolEffectPath(result.destination), pathType: result.pathType }], itemFailures: [] } };
}
