/* Recoverably deletes one file or directory inside the active Workspace. */
import type { RawToolResult, ToolDefinition } from '../tool';
import { inputRecord, optionalBoolean, requireString } from './tool-input';
import { toolEffectPath, withFileFailure, type BuiltInToolContext } from './workspace-file-access';

export const deletePathToolDefinition: ToolDefinition = {
  name: 'delete_path', title: 'Delete path', description: 'Move a file or directory to a recoverable Workspace location.',
  inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Path to delete.' }, recursive: { type: 'boolean', description: 'Allow a non-empty directory.' } }, required: ['path'], additionalProperties: false },
  annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false }, capabilities: ['project_write'], riskLevel: 'high', sideEffect: 'project_file_operation', availability: { status: 'available' }, executionMode: 'serial', permissionMetadata: { ruleToolName: 'delete_path' },
};
export async function executeDeletePath(context: BuiltInToolContext, input: unknown, signal?: AbortSignal): Promise<RawToolResult> {
  const record = inputRecord(input);
  const result = await withFileFailure('delete', () => context.workspaceFileAccess.deletePath({ path: requireString(record, 'path'), recursive: optionalBoolean(record, 'recursive', false), signal }));
  return { outputKind: 'json', content: result, effectReport: { coverage: 'complete', effects: [{ type: 'deleted', path: toolEffectPath(result.path), pathType: result.pathType, recoverable: true }], itemFailures: [] } };
}