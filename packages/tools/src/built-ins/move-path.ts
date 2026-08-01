/* Moves or renames one file or directory inside the active Workspace. */
import type { RawToolResult, ToolDefinition } from '../tool';
import { inputRecord, optionalBoolean, requireString } from './tool-input';
import { withFileFailure, type BuiltInToolContext } from './workspace-file-access';

export const movePathToolDefinition: ToolDefinition = {
  name: 'move_path', title: 'Move path', description: 'Move or rename a file or directory.',
  inputSchema: { type: 'object', properties: { source: { type: 'string', description: 'Source path.' }, destination: { type: 'string', description: 'Destination path.' }, overwrite: { type: 'boolean', description: 'Replace an existing destination.' } }, required: ['source', 'destination'], additionalProperties: false },
  annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false }, capabilities: ['project_write'], riskLevel: 'high', sideEffect: 'project_file_operation', availability: { status: 'available' }, executionMode: 'serial', permissionMetadata: { ruleToolName: 'move_path' },
};
export async function executeMovePath(context: BuiltInToolContext, input: unknown, signal?: AbortSignal): Promise<RawToolResult> {
  const record = inputRecord(input);
  const result = await withFileFailure('move', () => context.workspaceFileAccess.movePath({ source: requireString(record, 'source'), destination: requireString(record, 'destination'), overwrite: optionalBoolean(record, 'overwrite', false), signal }));
  return { outputKind: 'json', content: result, effectReport: { coverage: 'complete', effects: [{ type: 'moved', ...result }], itemFailures: [] } };
}