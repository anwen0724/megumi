// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ToolCall } from '@megumi/shared/tool-contracts';
import { createListDirectoryExecutor } from '@megumi/desktop/main/services/tool-executors/list-directory.executor';

describe('ListDirectoryExecutor', () => {
  it('lists project-local entries and excludes sensitive files', async () => {
    const executor = createListDirectoryExecutor({
      projectRoot: 'C:/project',
      fileSystem: fakeFileSystem(new Map([
        ['C:\\project\\src\\index.ts', 'export {}'],
        ['C:\\project\\src\\secret.pem', 'private key'],
        ['C:\\project\\src\\lib\\helper.ts', 'export {}'],
      ])),
      now: () => '2026-05-20T00:00:00.000Z',
      ids: { toolResultId: () => 'tool-result-1' },
    });

    await expect(executor.execute(toolCall('list_directory', { path: 'src' })))
      .resolves.toMatchObject({
        kind: 'success',
        structuredContent: {
          path: 'src',
          entries: [
            { name: 'lib', kind: 'directory' },
            { name: 'index.ts', kind: 'file' },
          ],
        },
      });
  });
});

function toolCall(toolName: string, input: Record<string, unknown>): ToolCall {
  return {
    toolCallId: 'tool-call-1',
    toolUseId: 'tool-use-1',
    runId: 'run-1',
    stepId: 'step-1',
    toolName,
    input: input as ToolCall['input'],
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
    async readFile() {
      return '';
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
