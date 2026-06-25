// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ToolExecution } from '@megumi/shared/tool';
import { createWriteFileExecutor } from '@megumi/coding-agent/tools/execution/tool-executors/write-file.executor';

describe('WriteFileExecutor', () => {
  it('creates parent directories and writes ordinary project files', async () => {
    const files = new Map<string, string>();
    const madeDirectories: string[] = [];
    const executor = createWriteFileExecutor({
      projectRoot: 'C:/project',
      fileSystem: fakeFileSystem(files, madeDirectories),
      now: () => '2026-05-20T00:00:00.000Z',
      ids: { toolResultId: () => 'tool-result-1' },
    });

    await expect(executor.execute(toolCall('write_file', {
      path: 'src/new.ts',
      content: 'export {}',
    }))).resolves.toMatchObject({
      isError: false,
      outputKind: 'diff',
      content: {
        structuredContent: { path: 'src/new.ts', created: true, overwritten: false },
      },
    });
    expect(files.get('C:\\project\\src\\new.ts')).toBe('export {}');
    expect(madeDirectories).toContain('C:\\project\\src');
  });

  it('rejects protected and sensitive writes', async () => {
    const executor = createWriteFileExecutor({
      projectRoot: 'C:/project',
      fileSystem: fakeFileSystem(new Map()),
      now: () => '2026-05-20T00:00:00.000Z',
      ids: { toolResultId: () => 'tool-result-1' },
    });

    await expect(executor.execute(toolCall('write_file', {
      path: '.git/config',
      content: 'config',
    }))).rejects.toThrow(/protected/);
    await expect(executor.execute(toolCall('write_file', {
      path: '.env',
      content: 'TOKEN=secret',
    }))).rejects.toThrow(/sensitive/);
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
    capabilities: ['project_write'],
    riskLevel: 'low',
    sideEffect: 'project_file_operation',
    status: 'running',
    requestedAt: '2026-05-20T00:00:00.000Z',
  };
}

function fakeFileSystem(files: Map<string, string>, madeDirectories: string[] = []) {
  return {
    async readFile(filePath: string) {
      const value = files.get(filePath);
      if (value === undefined) throw new Error(`Missing file: ${filePath}`);
      return value;
    },
    async writeFile(filePath: string, content: string) {
      files.set(filePath, content);
    },
    async mkdir(directoryPath: string) {
      madeDirectories.push(directoryPath);
    },
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


