import type { ToolDefinition } from '@megumi/shared/tool';

export const listDirectoryDefinition: ToolDefinition = {
  name: 'list_directory',
  title: 'List directory',
  description: 'List entries inside a project directory with depth and result limits.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Project-relative directory path.' },
      maxDepth: { type: 'integer', description: 'Optional recursive depth limit.' },
      limit: { type: 'integer', description: 'Optional maximum number of entries.' },
      includeHidden: { type: 'boolean', description: 'Whether hidden files should be included.' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      entries: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            kind: { type: 'string', enum: ['file', 'directory', 'other'] },
          },
        },
      },
      truncated: { type: 'boolean' },
    },
    required: ['entries', 'truncated'],
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  capabilities: ['project_read'],
  riskLevel: 'low',
  sideEffect: 'none',
  availability: { status: 'available' },
};

