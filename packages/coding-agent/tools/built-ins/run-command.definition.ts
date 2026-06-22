import type { ToolDefinition } from '@megumi/shared/tool';

export const runCommandDefinition: ToolDefinition = {
  name: 'run_command',
  title: 'Run command',
  description: 'Run a project-scoped command through the host command adapter and return redacted output previews.',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Command line to run inside the project boundary.' },
      cwd: { type: 'string', description: 'Optional project-relative working directory.' },
      timeoutMs: { type: 'integer', description: 'Optional timeout in milliseconds.' },
      envPolicy: {
        type: 'string',
        enum: ['default', 'minimal', 'none'],
        description: 'Environment exposure policy requested for the command.',
      },
    },
    required: ['command'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      exitCode: { type: 'integer' },
      stdoutPreview: { type: 'string' },
      stderrPreview: { type: 'string' },
      durationMs: { type: 'integer' },
      truncated: { type: 'boolean' },
    },
    required: ['exitCode', 'stdoutPreview', 'stderrPreview', 'durationMs', 'truncated'],
  },
  annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
  capabilities: ['command_run'],
  riskLevel: 'medium',
  sideEffect: 'execute_command',
  availability: { status: 'available' },
  executionMode: 'serial',
  permissionMetadata: { ruleToolName: 'run_command' },
  modelFacingDescription: 'Run a project-scoped command through the host command adapter and return redacted output previews.',
};

