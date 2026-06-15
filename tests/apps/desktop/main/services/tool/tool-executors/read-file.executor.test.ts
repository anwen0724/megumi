// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { ToolExecution } from '@megumi/shared/tool';
import { createReadFileExecutor } from '@megumi/desktop/main/services/tool/tool-executors/read-file.executor';

describe('ReadFileExecutor', () => {
  it('reads a project-local file and redacts runtime secrets', async () => {
    const executor = createReadFileExecutor({
      projectRoot: 'C:/project',
      fileSystem: fakeFileSystem(new Map([
        ['C:\\project\\src\\index.ts', 'const token = "sk-secret-token";'],
      ])),
      now: () => '2026-05-20T00:00:00.000Z',
      ids: { toolResultId: () => 'tool-result-1' },
    });

    await expect(executor.execute(toolCall('read_file', { path: 'src/index.ts' })))
      .resolves.toMatchObject({
        isError: false,
        outputKind: 'file',
        content: {
          structuredContent: {
            path: 'src/index.ts',
            content: 'const token = "[redacted]";',
            truncated: false,
          },
          textContent: 'const token = "[redacted]";',
          redactionState: 'redacted',
        },
      });
  });

  it('rejects paths outside the project', async () => {
    const executor = createReadFileExecutor({
      projectRoot: 'C:/project',
      fileSystem: fakeFileSystem(new Map()),
      now: () => '2026-05-20T00:00:00.000Z',
      ids: { toolResultId: () => 'tool-result-1' },
    });

    await expect(executor.execute(toolCall('read_file', { path: '../outside.txt' })))
      .rejects.toThrow(/outside the project/);
  });

  it('rejects protected project paths before reading from disk', async () => {
    const fileSystem = fakeFileSystem(new Map([
      ['C:\\project\\.git\\config', '[core]\nrepositoryformatversion = 0'],
    ]));
    const executor = createReadFileExecutor({
      projectRoot: 'C:/project',
      fileSystem,
      now: () => '2026-05-20T00:00:00.000Z',
      ids: { toolResultId: () => 'tool-result-1' },
    });

    await expect(executor.execute(toolCall('read_file', { path: '.git/config' })))
      .rejects.toThrow(/protected/);
    expect(fileSystem.readFile).not.toHaveBeenCalled();
  });

  it('rejects sensitive project paths before reading from disk', async () => {
    const fileSystem = fakeFileSystem(new Map([
      ['C:\\project\\.env', 'OPENAI_API_KEY=sk-secret-token'],
    ]));
    const executor = createReadFileExecutor({
      projectRoot: 'C:/project',
      fileSystem,
      now: () => '2026-05-20T00:00:00.000Z',
      ids: { toolResultId: () => 'tool-result-1' },
    });

    await expect(executor.execute(toolCall('read_file', { path: '.env' })))
      .rejects.toThrow(/sensitive/);
    expect(fileSystem.readFile).not.toHaveBeenCalled();
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
    readFile: vi.fn(async (filePath: string) => {
      const value = files.get(filePath);
      if (value === undefined) throw new Error(`Missing file: ${filePath}`);
      return value;
    }),
    async writeFile() {},
    async mkdir() {},
    async stat(filePath: string) {
      if (files.has(filePath)) {
        return { isFile: () => true, isDirectory: () => false, size: files.get(filePath)?.length ?? 0 };
      }
      throw new Error(`Missing path: ${filePath}`);
    },
    async readdir() {
      return [];
    },
  };
}


