import { describe, expect, it } from 'vitest';
import {
  ToolExecutionService,
  ToolRegistryService,
} from '@megumi/coding-agent/tools';
import { createBuiltInToolAdapter } from '@megumi/coding-agent/tools/adapters/built-in-tools';

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
});

function createService(files: Map<string, string>): ToolExecutionService {
  return new ToolExecutionService({
    registryService: new ToolRegistryService(),
    builtInTools: createBuiltInToolAdapter({
      projectRoot: 'C:/project',
      fileSystem: fakeFileSystem(files),
    }),
  });
}

function fakeFileSystem(files: Map<string, string>) {
  return {
    async readFile(filePath: string) {
      const value = files.get(filePath);
      if (value === undefined) throw new Error(`Missing file: ${filePath}`);
      return value;
    },
    async writeFile(filePath: string, content: string) {
      files.set(filePath, content);
    },
    async mkdir() {},
    async stat(filePath: string) {
      if (files.has(filePath)) {
        return { isFile: () => true, isDirectory: () => false, size: files.get(filePath)?.length ?? 0 };
      }
      const prefix = filePath.endsWith('\\') ? filePath : `${filePath}\\`;
      if ([...files.keys()].some((file) => file.startsWith(prefix))) {
        return { isFile: () => false, isDirectory: () => true, size: 0 };
      }
      throw new Error(`Missing path: ${filePath}`);
    },
    async readdir(filePath: string) {
      const prefix = filePath.endsWith('\\') ? filePath : `${filePath}\\`;
      const names = new Set<string>();
      for (const file of files.keys()) {
        if (!file.startsWith(prefix)) continue;
        const rest = file.slice(prefix.length);
        const name = rest.split('\\')[0];
        if (name) names.add(name);
      }
      return [...names].map((name) => {
        const full = `${prefix}${name}`;
        const isFile = files.has(full);
        return { name, isFile: () => isFile, isDirectory: () => !isFile };
      });
    },
  };
}
