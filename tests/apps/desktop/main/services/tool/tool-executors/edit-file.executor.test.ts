// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ToolExecution } from '@megumi/shared/tool';
import { createEditFileExecutor } from '@megumi/desktop/main/services/tool/tool-executors/edit-file.executor';

describe('EditFileExecutor', () => {
  it('replaces exact text in an ordinary project file', async () => {
    const files = new Map([['C:\\project\\src\\index.ts', 'export const answer = 41;']]);
    const executor = createEditFileExecutor({
      projectRoot: 'C:/project',
      fileSystem: fakeFileSystem(files),
      now: () => '2026-05-20T00:00:00.000Z',
      ids: { toolResultId: () => 'tool-result-1' },
    });

    await expect(executor.execute(toolCall('edit_file', {
      path: 'src/index.ts',
      oldText: '41',
      newText: '42',
    }))).resolves.toMatchObject({
      kind: 'success',
      structuredContent: { path: 'src/index.ts', replacements: 1 },
    });
    expect(files.get('C:\\project\\src\\index.ts')).toBe('export const answer = 42;');
  });

  it('rejects edits when oldText is not found', async () => {
    const executor = createEditFileExecutor({
      projectRoot: 'C:/project',
      fileSystem: fakeFileSystem(new Map([['C:\\project\\src\\index.ts', 'export {};']])),
      now: () => '2026-05-20T00:00:00.000Z',
      ids: { toolResultId: () => 'tool-result-1' },
    });

    await expect(executor.execute(toolCall('edit_file', {
      path: 'src/index.ts',
      oldText: 'missing',
      newText: 'value',
    }))).rejects.toThrow(/not found/);
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
      throw new Error(`Missing path: ${filePath}`);
    },
    async readdir() {
      return [];
    },
  };
}


