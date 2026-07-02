import { describe, expect, it, vi } from 'vitest';
import {
  ToolExecutionService,
  ToolRegistryService,
  type RegisteredTool,
} from '@megumi/coding-agent/tools';
import { createBuiltInToolAdapter, type WorkspaceFileAccess } from '@megumi/coding-agent/tools/adapters/built-in-tools';

describe('ToolExecutionService', () => {
  it('executes registered built-in tools and normalizes their output', async () => {
    const files = new Map<string, string>([
      ['C:\\project\\README.md', 'hello from service'],
    ]);
    const service = createService(files);

    const result = await service.executeTool({
      toolName: 'read_file',
      input: { path: 'README.md' },
    });

    expect(result).toMatchObject({
      type: 'succeeded',
      toolName: 'read_file',
      normalizedResult: {
        kind: 'text',
        content: 'hello from service',
        isError: false,
      },
    });
  });

  it('returns unknown_tool for unregistered tool names', async () => {
    const service = createService(new Map());

    await expect(service.executeTool({
      toolName: 'missing_tool',
      input: {},
    })).resolves.toMatchObject({
      type: 'failed',
      error: { code: 'unknown_tool' },
      normalizedResult: { isError: true },
    });
  });

  it('returns invalid_tool_input before adapter execution', async () => {
    const service = createService(new Map());

    await expect(service.executeTool({
      toolName: 'read_file',
      input: {},
    })).resolves.toMatchObject({
      type: 'failed',
      error: { code: 'invalid_tool_input' },
      normalizedResult: {
        content: 'Invalid tool input at $.path: missing required property.',
      },
    });
  });

  it('validates array item schemas before adapter execution', async () => {
    const adapter = {
      execute: vi.fn(async () => ({
        outputKind: 'text' as const,
        content: 'should not execute',
      })),
    };
    const service = new ToolExecutionService({
      registryService: {
        getRegisteredTool: () => ({
          type: 'found',
          tool: registeredToolWithSchema({
            type: 'object',
            properties: {
              paths: {
                type: 'array',
                items: { type: 'string', minLength: 1 },
              },
            },
            required: ['paths'],
            additionalProperties: false,
          }),
        }),
      },
      builtInTools: adapter,
    });

    const result = await service.executeTool({
      toolName: 'read_file',
      input: { paths: ['README.md', 42] },
    });

    expect(result).toMatchObject({
      type: 'failed',
      error: { code: 'invalid_tool_input' },
      normalizedResult: {
        content: 'Invalid tool input at $.paths[1]: expected string.',
      },
    });
    expect(adapter.execute).not.toHaveBeenCalled();
  });
});

function createService(files: Map<string, string>): ToolExecutionService {
  return new ToolExecutionService({
    registryService: new ToolRegistryService(),
    builtInTools: createBuiltInToolAdapter({
      workspaceFileAccess: fakeWorkspaceFileAccess(files),
    }),
  });
}

function fakeWorkspaceFileAccess(files: Map<string, string>): WorkspaceFileAccess {
  return {
    async readFile(input) {
      const filePath = `C:\\project\\${input.path}`;
      const value = files.get(filePath);
      if (value === undefined) throw new Error(`Missing file: ${filePath}`);
      const buffer = Buffer.from(value, 'utf8');
      return {
        path: input.path,
        content: buffer.byteLength > input.maxBytes ? buffer.subarray(0, input.maxBytes).toString('utf8') : value,
        truncated: buffer.byteLength > input.maxBytes,
        sizeBytes: buffer.byteLength,
      };
    },
    async readTextFile(input) {
      const filePath = `C:\\project\\${input.path}`;
      const value = files.get(filePath);
      if (value === undefined) throw new Error(`Missing file: ${filePath}`);
      return value;
    },
    async listDirectory(input) {
      return {
        path: input.path,
        entries: [],
        truncated: false,
      };
    },
    async walkFiles() {
      return [];
    },
    async replaceText() {
      throw new Error('Not implemented in this test');
    },
    async writeFile(input) {
      const filePath = `C:\\project\\${input.path}`;
      const exists = files.has(filePath);
      if (exists && !input.overwrite) {
        throw new Error(`File already exists: ${input.path}`);
      }
      files.set(filePath, input.content);
      return {
        path: input.path,
        bytesWritten: Buffer.byteLength(input.content, 'utf8'),
        created: !exists,
        overwritten: exists,
      };
    },
    async resolveCommandCwd() {
      return 'C:\\project';
    },
  };
}

function registeredToolWithSchema(inputSchema: RegisteredTool['definition']['inputSchema']): RegisteredTool {
  return {
    identity: {
      sourceId: 'built_in',
      namespace: 'megumi',
      sourceToolName: 'read_file',
    },
    registeredToolName: 'read_file',
    status: 'available',
    source: {
      sourceId: 'built_in',
      sourceKind: 'built_in',
      namespace: 'megumi',
      displayName: 'Built-in tools',
      configured: true,
      enabled: true,
      availabilityStatus: 'available',
    },
    definition: {
      name: 'read_file',
      description: 'Read a file.',
      inputSchema,
      capabilities: ['project_read'],
      riskLevel: 'low',
      sideEffect: 'none',
      availability: { status: 'available' },
    },
  };
}
