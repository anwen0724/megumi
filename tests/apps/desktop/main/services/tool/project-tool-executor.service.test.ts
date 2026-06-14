// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { ToolExecution } from '@megumi/shared/tool';
import { createProjectToolExecutor } from '@megumi/desktop/main/services/tool/project-tool-executor.service';

describe('ProjectToolExecutor', () => {
  it('reads and redacts project-local files', async () => {
    const files = new Map<string, string>([
      ['C:\\project\\README.md', 'hello sk-secret-token'],
    ]);
    const executor = createProjectToolExecutor({
      projectRoot: 'C:/project',
      fileSystem: fakeFileSystem(files),
      now: () => '2026-05-20T00:00:00.000Z',
      ids: { toolResultId: () => 'tool-result-1' },
    });

    const result = await executeToolResult(executor, toolCall('read_file', { path: 'README.md' }));

    expect(result).toMatchObject({
      toolResultId: 'tool-result-1',
      kind: 'success',
      structuredContent: {
        path: 'README.md',
        content: 'hello [redacted]',
        truncated: false,
      },
      textContent: 'hello [redacted]',
      redactionState: 'redacted',
      createdAt: '2026-05-20T00:00:00.000Z',
    });
  });

  it('lists, globs, and searches without leaving the project root', async () => {
    const files = new Map<string, string>([
      ['C:\\project\\src\\index.ts', 'export const answer = 42;'],
      ['C:\\project\\src\\secret.pem', 'private key'],
      ['C:\\project\\package.json', '{"scripts":{"test":"vitest"}}'],
    ]);
    const executor = createProjectToolExecutor({
      projectRoot: 'C:/project',
      fileSystem: fakeFileSystem(files),
      now: () => '2026-05-20T00:00:00.000Z',
      ids: { toolResultId: () => 'tool-result-1' },
    });

    await expect(executeToolResult(executor, toolCall('read_file', { path: '../outside.txt' })))
      .resolves.toMatchObject({ kind: 'tool_error' });

    expect(await executeToolResult(executor, toolCall('list_directory', { path: 'src' })))
      .toMatchObject({ structuredContent: { entries: [{ name: 'index.ts', kind: 'file' }] } });

    expect(await executeToolResult(executor, toolCall('glob', { pattern: 'src/*.ts' })))
      .toMatchObject({ structuredContent: { matches: ['src/index.ts'] } });

    expect(await executeToolResult(executor, toolCall('search_text', { query: 'answer', path: 'src' })))
      .toMatchObject({ structuredContent: { matches: [{ path: 'src/index.ts', line: 1 }] } });
  });

  it('edits and writes ordinary project files', async () => {
    const files = new Map<string, string>([
      ['C:\\project\\src\\index.ts', 'export const answer = 41;'],
    ]);
    const executor = createProjectToolExecutor({
      projectRoot: 'C:/project',
      fileSystem: fakeFileSystem(files),
      now: () => '2026-05-20T00:00:00.000Z',
      ids: { toolResultId: () => 'tool-result-1' },
    });

    expect(await executeToolResult(executor, toolCall('edit_file', {
      path: 'src/index.ts',
      oldText: '41',
      newText: '42',
    }))).toMatchObject({ structuredContent: { replacements: 1 } });
    expect(files.get('C:\\project\\src\\index.ts')).toBe('export const answer = 42;');

    expect(await executeToolResult(executor, toolCall('write_file', {
      path: 'src/new.ts',
      content: 'export {}',
    }))).toMatchObject({ structuredContent: { created: true, overwritten: false } });
    expect(files.get('C:\\project\\src\\new.ts')).toBe('export {}');
  });

  it('wraps edit_file and write_file with workspace change tracking when scope is provided', async () => {
    const files = new Map<string, string>([
      ['C:\\project\\src\\index.ts', 'export const answer = 41;'],
    ]);
    const workspaceChangeTracker = {
      trackToolExecution: vi.fn(async (input: { execute(): Promise<unknown> }) => input.execute()),
      finalizeChangeSet: vi.fn(),
    };
    const executor = createProjectToolExecutor({
      projectRoot: 'C:/project',
      fileSystem: fakeFileSystem(files),
      workspaceChangeTracker: workspaceChangeTracker as never,
      now: () => '2026-05-20T00:00:00.000Z',
      ids: { toolResultId: () => 'tool-result-1' },
    });

    await executor.executeToolExecution(
      toolCall('edit_file', {
        path: 'src/index.ts',
        oldText: '41',
        newText: '42',
      }),
      { sessionId: 'session-1', runId: 'run-1', stepId: 'step-1' },
    );

    expect(workspaceChangeTracker.trackToolExecution).toHaveBeenCalledWith(expect.objectContaining({
      scope: { sessionId: 'session-1', runId: 'run-1', stepId: 'step-1' },
      toolExecution: expect.objectContaining({ toolName: 'edit_file' }),
      execute: expect.any(Function),
    }));
    expect(files.get('C:\\project\\src\\index.ts')).toBe('export const answer = 42;');
  });

  it('dispatches run_command to the command executor', async () => {
    const spawn = vi.fn(() => fakeChildProcess({ stdout: 'ok\n', stderr: '', exitCode: 0 }));
    const executor = createProjectToolExecutor({
      projectRoot: 'C:/project',
      fileSystem: fakeFileSystem(new Map()),
      spawn,
      now: () => '2026-05-20T00:00:00.000Z',
      ids: { toolResultId: () => 'tool-result-1' },
    });

    await expect(executeToolResult(executor, toolCall('run_command', { command: 'npm test' })))
      .resolves.toMatchObject({
        kind: 'success',
        structuredContent: {
          exitCode: 0,
          stdoutPreview: 'ok\n',
        },
      });
    expect(spawn).toHaveBeenCalledWith(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', 'npm test'],
      expect.objectContaining({ cwd: expect.stringContaining('project') }),
    );
  });

  it('delegates run_command tracking decisions to workspace change tracking', async () => {
    const spawn = vi.fn(() => fakeChildProcess({ stdout: 'ok\n', stderr: '', exitCode: 0 }));
    const workspaceChangeTracker = {
      trackToolExecution: vi.fn(async (input: { execute(): Promise<unknown> }) => input.execute()),
      finalizeChangeSet: vi.fn(),
    };
    const executor = createProjectToolExecutor({
      projectRoot: 'C:/project',
      fileSystem: fakeFileSystem(new Map()),
      spawn,
      workspaceChangeTracker: workspaceChangeTracker as never,
      now: () => '2026-05-20T00:00:00.000Z',
      ids: { toolResultId: () => 'tool-result-1' },
    });

    await executor.executeToolExecution(
      toolCall('run_command', { command: 'npm test' }),
      { sessionId: 'session-1', runId: 'run-1', stepId: 'step-1' },
    );

    expect(workspaceChangeTracker.trackToolExecution).toHaveBeenCalledWith(expect.objectContaining({
      scope: { sessionId: 'session-1', runId: 'run-1', stepId: 'step-1' },
      toolExecution: expect.objectContaining({ toolName: 'run_command' }),
      execute: expect.any(Function),
    }));
  });
});

async function executeToolResult(
  executor: ReturnType<typeof createProjectToolExecutor>,
  toolExecution: ToolExecution,
): Promise<import('@megumi/shared/tool').ToolResult> {
  const routedResult = await executor.executeToolExecution(toolExecution);
  expect(routedResult.routed).toBe(true);
  return routedResult.toolResult;
}

function toolCall(toolName: string, input: Record<string, unknown>): ToolExecution {
  return {
    toolExecutionId: 'tool-execution-1',
    toolCallId: 'tool-call-1',
    runId: 'run-1',
    stepId: 'step-1',
    toolName,
    registrySnapshotId: 'tool-registry-snapshot-run-1',
    snapshotEntryId: `tool-registry-snapshot-entry-run-1-tool-registration-built_in-${toolName}-built_in-megumi-${toolName}`,
    modelVisibleName: toolName as ToolExecution['modelVisibleName'],
    canonicalToolId: `built_in:megumi:${toolName}`,
    sourceId: 'built_in',
    namespace: 'megumi',
    sourceToolName: toolName as ToolExecution['sourceToolName'],
    input: input as ToolExecution['input'],
    inputPreview: {
      summary: `${toolName}`,
      targets: [],
      redactionState: 'none',
    },
    capabilities: toolName === 'run_command'
      ? ['command_run']
      : toolName === 'edit_file' || toolName === 'write_file' ? ['project_write'] : ['project_read'],
    riskLevel: 'low',
    sideEffect: toolName === 'run_command'
      ? 'execute_command'
      : toolName === 'edit_file' || toolName === 'write_file' ? 'project_file_operation' : 'none',
    status: 'running',
    requestedAt: '2026-05-20T00:00:00.000Z',
  };
}

function fakeChildProcess(input: {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}) {
  const child = {
    stdout: {
      on: vi.fn((event: string, listener: (chunk: Buffer) => void) => {
        if (event === 'data' && input.stdout) {
          listener(Buffer.from(input.stdout));
        }
      }),
    },
    stderr: {
      on: vi.fn((event: string, listener: (chunk: Buffer) => void) => {
        if (event === 'data' && input.stderr) {
          listener(Buffer.from(input.stderr));
        }
      }),
    },
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      if (event === 'close') {
        queueMicrotask(() => listener(input.exitCode));
      }
      return child;
    }),
    kill: vi.fn(),
  };
  return child;
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


