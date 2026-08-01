/* Applies an exact text replacement to an existing workspace file. */
import type { RawToolResult, ToolDefinition } from '../tool';
import { inputRecord, requireString } from './tool-input';
import {
  assertTextMutationTarget,
  withFileFailure,
  type BuiltInToolContext,
} from './workspace-file-access';

export const editFileToolDefinition: ToolDefinition = {
  name: 'edit_file',
  title: 'Edit file',
  description: 'Apply an exact text replacement to an existing UTF-8 text file. Structured PDF and DOCX editing is not supported.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The file to edit. Relative paths are resolved from the current working directory.',
      },
      oldText: { type: 'string', description: 'Exact text to replace.' },
      newText: { type: 'string', description: 'Replacement text.' },
      replaceAll: { type: 'boolean', description: 'Whether all exact matches should be replaced.' },
    },
    required: ['path', 'oldText', 'newText'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: { path: { type: 'string' }, replacements: { type: 'integer' }, changed: { type: 'boolean' } },
    required: ['path', 'replacements', 'changed'],
  },
  annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
  capabilities: ['project_write'],
  riskLevel: 'medium',
  sideEffect: 'project_file_operation',
  availability: { status: 'available' },
  executionMode: 'serial',
  permissionMetadata: { ruleToolName: 'edit_file' },
  modelFacingDescription: 'Apply an exact text replacement to an existing UTF-8 text file. Do not use this tool to edit PDF or DOCX files.',
};

export async function executeEditFile(
  context: BuiltInToolContext,
  input: unknown,
  signal?: AbortSignal,
): Promise<RawToolResult> {
  const record = inputRecord(input);
  const targetPath = requireString(record, 'path');
  assertTextMutationTarget(targetPath);
  const result = await withFileFailure('edit', () => context.workspaceFileAccess.replaceText({
    path: targetPath,
    oldText: requireString(record, 'oldText'),
    newText: requireString(record, 'newText'),
    replaceAll: Boolean(record.replaceAll),
    signal,
  }));

  return {
    outputKind: 'json',
    content: {
      path: result.path,
      replacements: result.replacements,
      changed: result.changed,
    },
  };
}
