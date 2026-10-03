/* Copies one file or directory inside the active Workspace. */
import { fileContext } from '../../../sandbox/file-access';
import type { BuiltInToolContext } from '../../tool-contracts';
import type { RawToolResult, AgentTool } from '../../tool-contracts';
import { inputRecord, optionalBoolean, requireString } from '../../tool-input';
import { toolEffectPath, withFileFailure } from '../../../sandbox/file-access';

export const copyPathTool: AgentTool = {
  name: 'copy_path', description: 'Copy a file or directory.',
  promptSnippet: 'Copy a file or directory.',
  parameters: { type: 'object', properties: { source: { type: 'string', description: 'Source path.' }, destination: { type: 'string', description: 'Destination path.' }, overwrite: { type: 'boolean', description: 'Replace an existing destination.' } }, required: ['source', 'destination'], additionalProperties: false },
  annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
  executionMode: 'serial',
  operations: (input) => [
    { action: 'workspace.read', resource: { type: 'workspace.path', id: requireString(inputRecord(input), 'source') } },
    { action: 'workspace.write', resource: { type: 'workspace.path', id: requireString(inputRecord(input), 'destination') } },
  ],
  execute: (input, execution) => executeCopyPath(fileContext(execution), input, execution.signal),
};

/** Executes the validated built-in operation within its supplied access scope. */
async function executeCopyPath(context: BuiltInToolContext, input: unknown, signal?: AbortSignal): Promise<RawToolResult> {
  const record = inputRecord(input);
  const result = await withFileFailure('copy', () => context.workspaceFileAccess.copyPath({ source: requireString(record, 'source'), destination: requireString(record, 'destination'), overwrite: optionalBoolean(record, 'overwrite', false), signal }));
  return { outputKind: 'json', content: result, effectReport: { coverage: 'complete', effects: [{ type: 'copied', source: toolEffectPath(result.source), destination: toolEffectPath(result.destination), pathType: result.pathType }], itemFailures: [] } };
}
