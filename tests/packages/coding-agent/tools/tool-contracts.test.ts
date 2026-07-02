import { describe, expect, it } from 'vitest';
import type {
  ExecuteToolRequest,
  GetRegisteredToolRequest,
  ListAvailableToolsResult,
  RegisteredTool,
  ToolExecutionError,
  ToolExecutionResult,
  ToolSource,
} from '@megumi/coding-agent/tools';

describe('tool contracts', () => {
  it('models registered tools as registry output entries', () => {
    const source: ToolSource = {
      sourceId: 'built_in',
      sourceKind: 'built_in',
      namespace: 'megumi',
      displayName: 'Built-in tools',
      configured: true,
      enabled: true,
      availabilityStatus: 'available',
    };

    const tool: RegisteredTool = {
      identity: {
        sourceId: 'built_in',
        namespace: 'megumi',
        sourceToolName: 'read_file',
      },
      registeredToolName: 'read_file',
      source,
      status: 'available',
      definition: {
        name: 'read_file',
        description: 'Read a file from the workspace.',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
        capabilities: ['project_read'],
        riskLevel: 'low',
        sideEffect: 'none',
        availability: { status: 'available' },
      },
    };

    const listResult: ListAvailableToolsResult = { tools: [tool] };
    const lookupRequest: GetRegisteredToolRequest = { toolName: 'read_file' };

    expect(listResult.tools[0].registeredToolName).toBe(lookupRequest.toolName);
    expect(listResult.tools[0]).not.toHaveProperty('modelVisibleName');
  });

  it('models execution requests around model tool call names', () => {
    const request: ExecuteToolRequest = {
      toolName: 'read_file',
      input: { path: 'README.md' },
      options: { signal: new AbortController().signal },
    };

    expect(request.toolName).toBe('read_file');
    expect(request).not.toHaveProperty('toolIdentity');
    expect(request).not.toHaveProperty('executionContext');
  });

  it('requires failed execution results to include normalized tool output', () => {
    const error: ToolExecutionError = {
      code: 'unknown_tool',
      message: 'Tool not found',
    };
    const result: ToolExecutionResult = {
      type: 'failed',
      toolName: 'unknown_tool',
      error,
      normalizedResult: {
        kind: 'error',
        content: 'Tool not found',
        isError: true,
        truncated: false,
      },
      toolExecutionObservation: {
        summary: 'Tool not found',
      },
    };

    expect(result.normalizedResult.content).toContain('Tool not found');
  });
});
