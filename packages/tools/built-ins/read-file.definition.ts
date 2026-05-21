import type { ToolDefinition } from '@megumi/shared/tool-contracts';

export const readFileDefinition: ToolDefinition = {
  name: 'read_file',
  title: 'Read file',
  description: 'Read a text file inside the current project and return redacted, size-limited content.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Project-relative file path.' },
      maxBytes: { type: 'integer', description: 'Optional maximum bytes to return.' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      content: { type: 'string' },
      truncated: { type: 'boolean' },
      sizeBytes: { type: 'integer' },
    },
    required: ['content', 'truncated', 'sizeBytes'],
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  capabilities: ['project_read'],
  riskLevel: 'low',
  sideEffect: 'none',
  availability: { status: 'available' },
};
