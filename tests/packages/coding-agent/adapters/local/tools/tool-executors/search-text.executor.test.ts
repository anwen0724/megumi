// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ToolExecution } from '@megumi/shared/tool';
import { createSearchTextExecutor } from '@megumi/coding-agent/adapters/local/tools/tool-executors/search-text.executor';

describe('SearchTextExecutor', () => {
  it('searches text under a project path and redacts snippets', async () => {
    const executor = createSearchTextExecutor({
      projectRoot: 'C:/project',
      fileSystem: fakeFileSystem(new Map([
        ['C:\\project\\src\\index.ts', 'const token = "sk-secret-token";\nexport const answer = 42;'],
        ['C:\\project\\src\\secret.pem', 'answer private'],
      ])),
      now: () => '2026-05-20T00:00:00.000Z',
      ids: { toolResultId: () => 'tool-result-1' },
    });

    await expect(executor.execute(toolCall('search_text', { query: 'token', path: 'src' })))
      .resolves.toMatchObject({
        isError: false,
        outputKind: 'json',
        content: {
          structuredContent: {
            path: 'src',
            matches: [{
              path: 'src/index.ts',
              line: 1,
              snippet: 'const token = "[redacted]";',
            }],
          },
          redactionState: 'redacted',
        },
      });
  });

  it('returns normalized slash project-relative search root paths', async () => {
    const executor = createSearchTextExecutor({
      projectRoot: 'C:/project',
      fileSystem: fakeFileSystem(new Map([
        ['C:\\project\\src\\nested\\index.ts', 'needle'],
      ])),
      now: () => '2026-05-20T00:00:00.000Z',
      ids: { toolResultId: () => 'tool-result-1' },
    });

    await expect(executor.execute(toolCall('search_text', { query: 'needle', path: '.\\src' })))
      .resolves.toMatchObject({
        isError: false,
        outputKind: 'json',
        content: {
          structuredContent: {
            path: 'src',
            matches: [{
              path: 'src/nested/index.ts',
              line: 1,
              snippet: 'needle',
            }],
          },
        },
      });
  });
});

function toolCall(toolName: string, input: Record<string, unknown>): ToolExecution {
  return {
    toolExecutionId: 'tool-execution-1',
    toolCallId: 'tool-call-1',
    runId: 'run-1',
    stepId: 'step-1',
    toolName,
    input: input as ToolExecution['input'],
    inputPreview: { summary: toolName, targets: [], redactionState: 'none' },
    capabilities: ['project_read'],
    riskLevel: 'low',
    sideEffect: 'none',
    status: 'running',
    requestedAt: '2026-05-20T00:00:00.000Z',
  };
}

function fakeFileSystem(files: Map<string, string>) {
  return {
    async readFile(filePath: string) {
      const value = files.get(filePath);
      if (value === undefined) throw new Error(`Missing file: ${filePath}`);
      return value;
    },
    async writeFile() {},
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


