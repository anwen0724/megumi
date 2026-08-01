/* Creates one directory inside the active Workspace. */
import type { RawToolResult, ToolDefinition } from '../tool';
import { inputRecord, optionalBoolean, requireString } from './tool-input';
import { toolEffectPath, withFileFailure, type BuiltInToolContext } from './workspace-file-access';

export const createDirectoryToolDefinition: ToolDefinition = {
  name: 'create_directory', title: 'Create directory', description: 'Create a directory.',
  inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Directory path.' }, recursive: { type: 'boolean', description: 'Create missing parent directories.' } }, required: ['path'], additionalProperties: false },
  annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
  capabilities: ['project_write'], riskLevel: 'medium', sideEffect: 'project_file_operation', availability: { status: 'available' }, executionMode: 'serial', permissionMetadata: { ruleToolName: 'create_directory' },
};
export async function executeCreateDirectory(context: BuiltInToolContext, input: unknown, signal?: AbortSignal): Promise<RawToolResult> {
  const record = inputRecord(input);
  const result = await withFileFailure('create_directory', () => context.workspaceFileAccess.createDirectory({ path: requireString(record, 'path'), recursive: optionalBoolean(record, 'recursive', false), signal }));
  return { outputKind: 'json', content: result, effectReport: { coverage: 'complete', effects: result.created ? [{ type: 'created', path: toolEffectPath(result.path), pathType: 'directory' }] : [], itemFailures: [] } };
}