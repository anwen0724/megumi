import type { ToolDefinition } from '@megumi/shared/tool-contracts';

export const editFileDefinition: ToolDefinition = {
  name: 'edit_file',
  title: 'Edit file',
  description: 'Apply an auditable exact text replacement to an existing project file.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Project-relative file path.' },
      oldText: { type: 'string', description: 'Exact text to replace.' },
      newText: { type: 'string', description: 'Replacement text.' },
      replaceAll: { type: 'boolean', description: 'Whether all exact matches should be replaced.' },
    },
    required: ['path', 'oldText', 'newText'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      replacements: { type: 'integer' },
      changed: { type: 'boolean' },
    },
    required: ['path', 'replacements', 'changed'],
  },
  annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
  capabilities: ['project_write'],
  riskLevel: 'medium',
  sideEffect: 'project_file_operation',
  availability: { status: 'available' },
};
