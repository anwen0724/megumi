// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createBuiltInToolSourceExecutor } from '@megumi/coding-agent/adapters/local/tools/built-in-tool-source-executor';
import type { ToolExecution } from '@megumi/shared/tool';

describe('BuiltInToolSourceExecutor', () => {
  it('executes built-in tools by sourceToolName and preserves workspace change tracking', async () => {
    const files = new Map<string, string>([
      ['C:\\project\\README.md', 'hello from built-in source'],
      ['C:\\project\\src\\index.ts', 'export const answer = 41;'],
    ]);
    const workspaceChangeTracker = {
      trackToolExecution: vi.fn(async (input: { execute(): Promise<unknown> }) => input.execute()),
      finalizeChangeSet: vi.fn(),
    };
    const executor = createBuiltInToolSourceExecutor({
      projectRoot: 'C:/project',
      fileSystem: fakeFileSystem(files),
      workspaceChangeTracker: workspaceChangeTracker as never,
      now: () => '2026-06-14T00:00:00.000Z',
      ids: { toolResultId: () => 'tool-result-1' },
    });

    const readResult = await executor.executeToolExecution(toolExecution({
      toolName: 'not_used_for_dispatch',
      sourceToolName: 'read_file',
      input: { path: 'README.md' },
    }));
    expect(readResult).toMatchObject({
      isError: false,
      content: {
        textContent: 'hello from built-in source',
        structuredContent: { content: 'hello from built-in source' },
      },
    });

    await executor.executeToolExecution(
      toolExecution({
        toolName: 'not_used_for_dispatch',
        sourceToolName: 'write_file',
        canonicalToolId: 'built_in:megumi:write_file',
        modelVisibleName: 'write_file',
        input: { path: 'src/new.ts', content: 'export {}' },
      }),
      { scope: { sessionId: 'session-1', runId: 'run-1', stepId: 'step-1' } },
    );

    expect(workspaceChangeTracker.trackToolExecution).toHaveBeenCalledWith(expect.objectContaining({
      scope: { sessionId: 'session-1', runId: 'run-1', stepId: 'step-1' },
      toolExecution: expect.objectContaining({ sourceToolName: 'write_file' }),
      execute: expect.any(Function),
    }));
    expect(files.get('C:\\project\\src\\new.ts')).toBe('export {}');
  });

  it('rejects non built-in source identity as tool_error result', async () => {
    const executor = createBuiltInToolSourceExecutor({
      projectRoot: 'C:/project',
      fileSystem: fakeFileSystem(new Map()),
      now: () => '2026-06-14T00:00:00.000Z',
      ids: { toolResultId: () => 'tool-result-1' },
    });

    const result = await executor.executeToolExecution(toolExecution({
      sourceId: 'external_test',
      namespace: 'demo',
      sourceToolName: 'echo',
      modelVisibleName: 'demo_echo',
      canonicalToolId: 'external_test:demo:echo',
      toolName: 'demo_echo',
      input: { message: 'hello' },
    }));

    expect(result.isError).toBe(true);
    expect(result.content).toMatchObject({
      message: expect.stringContaining('Unsupported built-in tool source'),
    });
  });
});

function toolExecution(overrides: Partial<ToolExecution> = {}): ToolExecution {
  return {
    toolExecutionId: 'tool-execution-1',
    toolCallId: 'tool-call-1',
    runId: 'run-1',
    stepId: 'step-1',
    toolName: 'read_file',
    registrySnapshotId: 'tool-registry-snapshot-run-1',
    snapshotEntryId: 'tool-registry-snapshot-entry-run-1-tool-registration-built_in-read_file-built_in-megumi-read_file',
    modelVisibleName: 'read_file',
    canonicalToolId: 'built_in:megumi:read_file',
    sourceId: 'built_in',
    namespace: 'megumi',
    sourceToolName: 'read_file',
    input: { path: 'README.md' },
    inputPreview: { summary: 'read_file', targets: [], redactionState: 'none' },
    capabilities: ['project_read'],
    riskLevel: 'low',
    sideEffect: 'none',
    status: 'running',
    requestedAt: '2026-06-14T00:00:00.000Z',
    ...overrides,
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
