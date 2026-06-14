import type { ToolDefinition } from '@megumi/shared/tool';

export const writeFileDefinition: ToolDefinition = {
  name: 'write_file',
  title: 'Write file',
  description: 'Create or overwrite a project file with provided text content.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Project-relative file path.' },
      content: { type: 'string', description: 'Text content to write.' },
      overwrite: { type: 'boolean', description: 'Whether an existing file may be overwritten.' },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      bytesWritten: { type: 'integer' },
      created: { type: 'boolean' },
      overwritten: { type: 'boolean' },
    },
    required: ['path', 'bytesWritten', 'created', 'overwritten'],
  },
  annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
  capabilities: ['project_write'],
  riskLevel: 'medium',
  sideEffect: 'project_file_operation',
  availability: { status: 'available' },
  executionMode: 'sequential',
  permissionMetadata: { ruleToolName: 'write_file' },
  modelFacingDescription: 'Create or overwrite a project file with provided text content.',
};

