import type { ToolDefinition } from '@megumi/shared/tool';

export const searchTextDefinition: ToolDefinition = {
  name: 'search_text',
  title: 'Search text',
  description: 'Search text inside project files and return redacted, size-limited matches.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Text or regular expression to search for.' },
      path: { type: 'string', description: 'Optional project-relative path to search in.' },
      caseSensitive: { type: 'boolean', description: 'Whether matching is case-sensitive.' },
      limit: { type: 'integer', description: 'Optional maximum number of matches.' },
    },
    required: ['query'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      matches: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            line: { type: 'integer' },
            preview: { type: 'string' },
          },
        },
      },
      truncated: { type: 'boolean' },
    },
    required: ['matches', 'truncated'],
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  capabilities: ['project_read'],
  riskLevel: 'low',
  sideEffect: 'none',
  availability: { status: 'available' },
  executionMode: 'parallel',
  permissionMetadata: { ruleToolName: 'search_text' },
  modelFacingDescription: 'Search text inside project files and return redacted, size-limited matches.',
};

