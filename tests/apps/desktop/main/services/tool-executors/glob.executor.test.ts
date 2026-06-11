// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ToolExecution } from '@megumi/shared/tool';
import { createGlobExecutor } from '@megumi/desktop/main/services/tool-executors/glob.executor';

describe('GlobExecutor', () => {
  it('matches simple project-local glob patterns and excludes sensitive files', async () => {
    const executor = createGlobExecutor({
      projectRoot: 'C:/project',
      fileSystem: fakeFileSystem(new Map([
        ['C:\\project\\src\\index.ts', 'export {}'],
        ['C:\\project\\src\\readme.md', '# src'],
        ['C:\\project\\src\\secret.key', 'secret'],
      ])),
      now: () => '2026-05-20T00:00:00.000Z',
      ids: { toolResultId: () => 'tool-result-1' },
    });

    await expect(executor.execute(toolCall('glob', { pattern: 'src/*' })))
      .resolves.toMatchObject({
        kind: 'success',
        structuredContent: {
          matches: ['src/index.ts', 'src/readme.md'],
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

