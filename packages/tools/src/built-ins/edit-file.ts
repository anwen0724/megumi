/* Applies ordered, conflict-safe text edits to one Workspace file. */
import type { RawToolResult, ToolDefinition } from '../tool';
import { inputRecord, requireString } from './tool-input';
import { assertTextMutationTarget, toolEffectPath, withFileFailure, type BuiltInToolContext } from './workspace-file-access';
import { createBuiltInToolHandler, inputString, operation } from './tool-handler';

export const editFileToolDefinition: ToolDefinition = {
  name: 'edit_file', description: 'Apply ordered exact-text edits to an existing UTF-8 text file.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path.' },
      edits: { type: 'array', items: { type: 'object', properties: { oldText: { type: 'string', minLength: 1 }, newText: { type: 'string' } }, required: ['oldText', 'newText'], additionalProperties: false } },
      expectedFingerprint: { type: 'string', description: 'Optional fingerprint returned by read_file.' },
    },
    required: ['path', 'edits'], additionalProperties: false,
  },
  annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
};

export const editFileToolHandler = createBuiltInToolHandler({
  toolName: 'edit_file',
  operations: (invocation) => [operation(invocation, 'workspace.write', { type: 'workspace.path', id: inputString(invocation, 'path') })],
  execute: (context, input, options) => executeEditFile(context, input, options.signal),
});

export async function executeEditFile(context: BuiltInToolContext, input: unknown, signal?: AbortSignal): Promise<RawToolResult> {
  const record = inputRecord(input);
  const targetPath = requireString(record, 'path');
  assertTextMutationTarget(targetPath);
  if (!Array.isArray(record.edits)) throw new Error('edits must be an array.');
  const edits = record.edits.map((value) => {
    const edit = inputRecord(value);
    return { oldText: requireString(edit, 'oldText'), newText: typeof edit.newText === 'string' ? edit.newText : (() => { throw new Error('Missing or invalid string input: newText'); })() };
  });
  const result = await withFileFailure('edit', () => context.workspaceFileAccess.editFile({ path: targetPath, edits, ...(typeof record.expectedFingerprint === 'string' ? { expectedFingerprint: record.expectedFingerprint } : {}), signal }));
  return { outputKind: 'json', content: { path: result.path, replacements: result.replacements, changed: result.changed, fingerprint: result.fingerprint }, effectReport: { coverage: 'complete', effects: result.changed ? [{ type: 'modified', path: toolEffectPath(result.path), pathType: 'file' }] : [], itemFailures: [] } };
}
