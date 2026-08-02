/* Creates or overwrites a text file inside the active workspace. */
import type { RawToolResult, ToolDefinition } from '../tool';
import { inputRecord, requireString } from './tool-input';
import {
  assertTextMutationTarget,
  toolEffectPath,
  withFileFailure,
  type BuiltInToolContext,
} from './workspace-file-access';
import { createBuiltInToolHandler, inputString, operation } from './tool-handler';

export const writeFileToolDefinition: ToolDefinition = {
  name: 'write_file',
  description: 'Create or overwrite a UTF-8 text file with provided text content. Structured PDF and DOCX writing is not supported.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The file to write. Relative paths are resolved from the current working directory.',
      },
      content: { type: 'string', description: 'Text content to write.' },
      overwrite: { type: 'boolean', description: 'Whether an existing file may be overwritten.' },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' }, bytesWritten: { type: 'integer' },
      created: { type: 'boolean' }, overwritten: { type: 'boolean' },
    },
    required: ['path', 'bytesWritten', 'created', 'overwritten'],
  },
  annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
};

export const writeFileToolHandler = createBuiltInToolHandler({
  toolName: 'write_file',
  operations: (invocation) => [operation(invocation, 'workspace.write', {
    type: 'workspace.path', id: inputString(invocation, 'path'),
  })],
  execute: (context, input, options) => executeWriteFile(context, input, options.signal),
});

export async function executeWriteFile(
  context: BuiltInToolContext,
  input: unknown,
  signal?: AbortSignal,
): Promise<RawToolResult> {
  const record = inputRecord(input);
  const targetPath = requireString(record, 'path');
  assertTextMutationTarget(targetPath);
  const result = await withFileFailure('write', () => context.workspaceFileAccess.writeFile({
    path: targetPath,
    content: requireString(record, 'content'),
    overwrite: Boolean(record.overwrite),
    signal,
  }));

  return {
    outputKind: 'json',
    content: {
      path: result.path,
      bytesWritten: result.bytesWritten,
      created: result.created,
      overwritten: result.overwritten,
      fingerprint: result.fingerprint,
    },
    effectReport: {
      coverage: 'complete',
      effects: result.created
        ? [{ type: 'created', path: toolEffectPath(result.path), pathType: 'file' }]
        : [{ type: 'modified', path: toolEffectPath(result.path), pathType: 'file' }],
      itemFailures: [],
    },
  };
}
