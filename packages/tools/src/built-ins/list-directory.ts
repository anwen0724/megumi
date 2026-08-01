/* Lists direct entries from a directory inside the active workspace. */
import type { RawToolResult, ToolDefinition } from '../tool';
import { buildBoundedItemPage } from './bounded-page';
import {
  inputRecord,
  optionalBoolean,
  optionalNonNegativeInteger,
  optionalPositiveInteger,
  optionalString,
} from './tool-input';
import { withFileFailure, type BuiltInToolContext } from './workspace-file-access';

export const listDirectoryToolDefinition: ToolDefinition = {
  name: 'list_directory',
  title: 'List directory',
  description: 'List files and directories.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The directory to list. Relative paths are resolved from the current working directory.',
      },
      maxDepth: { type: 'integer', description: 'Optional recursive depth limit.' },
      limit: { type: 'integer', description: 'Optional maximum number of entries.' },
      includeHidden: { type: 'boolean', description: 'Whether hidden files should be included.' },
      offset: { type: 'integer', minimum: 0, description: 'Entry offset. Defaults to 0.' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      entries: { type: 'array', items: { type: 'object', properties: {
        path: { type: 'string' }, kind: { type: 'string', enum: ['file', 'directory', 'other'] },
      } } },
      offset: { type: 'integer' }, hasMore: { type: 'boolean' }, nextOffset: { type: 'integer' },
    },
    required: ['entries', 'offset', 'hasMore'],
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  capabilities: ['project_read'],
  riskLevel: 'low',
  sideEffect: 'none',
  availability: { status: 'available' },
  executionMode: 'parallel',
  permissionMetadata: { ruleToolName: 'list_directory' },
  modelFacingDescription: 'List files and directories.',
};

export async function executeListDirectory(
  context: BuiltInToolContext,
  input: unknown,
  signal?: AbortSignal,
): Promise<RawToolResult> {
  const record = inputRecord(input);
  const requestedPath = optionalString(record, 'path', '.');
  const maxDepth = optionalPositiveInteger(record, 'maxDepth', 1);
  const limit = optionalPositiveInteger(record, 'limit', 100);
  const includeHidden = optionalBoolean(record, 'includeHidden', false);
  const offset = optionalNonNegativeInteger(record, 'offset', 0);
  const result = await withFileFailure('list', () => context.workspaceFileAccess.listDirectory({
    path: requestedPath,
    maxDepth,
    includeHidden,
    signal,
  }));

  return {
    outputKind: 'json',
    content: buildBoundedItemPage({
      items: result.entries,
      offset,
      limit,
      contentFor: (entries, page) => ({ path: result.path, entries, ...page }),
    }),
  };
}
