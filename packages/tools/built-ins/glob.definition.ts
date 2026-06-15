import type { ToolDefinition } from '@megumi/shared/tool';

export const globDefinition: ToolDefinition = {
  name: 'glob',
  title: 'Find files',
  description: 'Find project files matching a glob pattern without reading file content.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern evaluated inside the project.' },
      cwd: { type: 'string', description: 'Optional project-relative directory to search from.' },
      limit: { type: 'integer', description: 'Optional maximum number of matches.' },
      includeHidden: { type: 'boolean', description: 'Whether hidden files should be included.' },
    },
    required: ['pattern'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      matches: {
        type: 'array',
        items: { type: 'string' },
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
  permissionMetadata: { ruleToolName: 'glob' },
  modelFacingDescription: 'Find project files matching a glob pattern without reading file content.',
};

