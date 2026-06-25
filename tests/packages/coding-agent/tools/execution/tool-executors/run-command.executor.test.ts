// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { ToolExecution } from '@megumi/shared/tool';
import {
  createRunCommandExecutor,
  type SpawnLike,
} from '@megumi/coding-agent/tools/execution/tool-executors/run-command.executor';

describe('RunCommandExecutor', () => {
  it('runs project-bound commands through a Host adapter without exposing a powershell tool name', async () => {
    const spawn = vi.fn(() => fakeChildProcess({
      stdout: 'ok token=secret\n',
      stderr: '',
      exitCode: 0,
    }));
    const executor = createRunCommandExecutor({
      projectRoot: 'C:/project',
      spawn,
      nowMs: (() => {
        let value = 1000;
        return () => {
          value += 25;
          return value;
        };
      })(),
      now: () => '2026-05-20T00:00:00.000Z',
      ids: { toolResultId: () => 'tool-result-1' },
    });

    const result = await executor.runCommand({
      command: 'npm test',
      cwd: '.',
      timeoutMs: 1000,
    });

    expect(spawn).toHaveBeenCalledWith(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', 'npm test'],
      expect.objectContaining({ cwd: expect.stringContaining('project') }),
    );
    expect(result).toMatchObject({
      exitCode: 0,
      stdoutPreview: 'ok token=[redacted]\n',
      stderrPreview: '',
      durationMs: 25,
      truncated: false,
    });
  });

  it('returns a model-consumable ToolResult from execute', async () => {
    const executor = createRunCommandExecutor({
      projectRoot: 'C:/project',
      spawn: vi.fn(() => fakeChildProcess({
        stdout: 'passed\n',
        stderr: 'warn token=secret\n',
        exitCode: 1,
      })),
      nowMs: (() => {
        let value = 0;
        return () => {
          value += 8;
          return value;
        };
      })(),
      now: () => '2026-05-20T00:00:00.000Z',
      ids: { toolResultId: () => 'tool-result-1' },
    });

    await expect(executor.execute(toolCall({ command: 'npm test' })))
      .resolves.toMatchObject({
        rawToolResultId: 'tool-result-1',
        toolCallId: 'tool-call-1',
        toolExecutionId: 'tool-execution-1',
        isError: true,
        outputKind: 'command',
        content: {
          structuredContent: {
            exitCode: 1,
            stdoutPreview: 'passed\n',
            stderrPreview: 'warn token=[redacted]\n',
            durationMs: 8,
            truncated: false,
          },
          textContent: expect.stringContaining('stdout:\npassed\n'),
          redactionState: 'redacted',
        },
        createdAt: '2026-05-20T00:00:00.000Z',
      });
  });

  it('runs commands with an empty environment when envPolicy is none', async () => {
    const spawn = vi.fn(() => fakeChildProcess({
      stdout: '',
      stderr: '',
      exitCode: 0,
    }));
    const executor = createRunCommandExecutor({
      projectRoot: 'C:/project',
      spawn,
      now: () => '2026-05-20T00:00:00.000Z',
      ids: { toolResultId: () => 'tool-result-1' },
    });

    await executor.runCommand({ command: 'npm test', envPolicy: 'none' });

    expect(spawn).toHaveBeenCalledWith(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', 'npm test'],
      expect.objectContaining({ env: {} }),
    );
  });

  it('runs commands with process.env when envPolicy is default', async () => {
    const spawn = vi.fn(() => fakeChildProcess({
      stdout: '',
      stderr: '',
      exitCode: 0,
    }));
    const executor = createRunCommandExecutor({
      projectRoot: 'C:/project',
      spawn,
      now: () => '2026-05-20T00:00:00.000Z',
      ids: { toolResultId: () => 'tool-result-1' },
    });

    await executor.runCommand({ command: 'npm test', envPolicy: 'default' });

    expect(spawn).toHaveBeenCalledWith(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', 'npm test'],
      expect.objectContaining({ env: process.env }),
    );
  });

  it('accepts minimal envPolicy and passes only a safe environment subset', async () => {
    const previousSecret = process.env.MEGUMI_RUN_COMMAND_SECRET_TEST_KEY;
    process.env.MEGUMI_RUN_COMMAND_SECRET_TEST_KEY = 'secret-value';
    let capturedEnv: NodeJS.ProcessEnv | undefined;
    const spawn = vi.fn<SpawnLike>((_command, _args, options) => {
      capturedEnv = options.env;
      return fakeChildProcess({
        stdout: 'ok\n',
        stderr: '',
        exitCode: 0,
      });
    });
    const executor = createRunCommandExecutor({
      projectRoot: 'C:/project',
      spawn,
      now: () => '2026-05-20T00:00:00.000Z',
      ids: { toolResultId: () => 'tool-result-1' },
    });

    try {
      await expect(executor.execute(toolCall({ command: 'npm test', envPolicy: 'minimal' })))
        .resolves.toMatchObject({
          isError: false,
          outputKind: 'command',
          content: {
            structuredContent: {
              stdoutPreview: 'ok\n',
            },
          },
        });

      expect(capturedEnv).toBeDefined();
      expect(capturedEnv).not.toBe(process.env);
      expect(capturedEnv).not.toHaveProperty('MEGUMI_RUN_COMMAND_SECRET_TEST_KEY');
    } finally {
      if (previousSecret === undefined) {
        delete process.env.MEGUMI_RUN_COMMAND_SECRET_TEST_KEY;
      } else {
        process.env.MEGUMI_RUN_COMMAND_SECRET_TEST_KEY = previousSecret;
      }
    }
  });

  it('truncates stdout and stderr previews at the output limit', async () => {
    const largeOutput = 'x'.repeat(64 * 1024 + 1);
    const executor = createRunCommandExecutor({
      projectRoot: 'C:/project',
      spawn: vi.fn(() => fakeChildProcess({
        stdout: largeOutput,
        stderr: largeOutput,
        exitCode: 0,
      })),
      nowMs: () => 0,
      now: () => '2026-05-20T00:00:00.000Z',
      ids: { toolResultId: () => 'tool-result-1' },
    });

    const result = await executor.runCommand({ command: 'npm test' });

    expect(result.stdoutPreview).toHaveLength(64 * 1024);
    expect(result.stderrPreview).toHaveLength(64 * 1024);
    expect(result.truncated).toBe(true);
  });

  it('preserves multibyte UTF-8 characters split across stdout chunks', async () => {
    const multibyte = Buffer.from('中', 'utf8');
    const executor = createRunCommandExecutor({
      projectRoot: 'C:/project',
      spawn: vi.fn(() => fakeChildProcess({
        stdout: [
          multibyte.subarray(0, 1),
          multibyte.subarray(1),
          '\n',
        ],
        stderr: '',
        exitCode: 0,
      })),
      now: () => '2026-05-20T00:00:00.000Z',
      ids: { toolResultId: () => 'tool-result-1' },
    });

    const result = await executor.runCommand({ command: 'npm test' });

    expect(result.stdoutPreview).toBe('中\n');
  });

  it('rejects cwd outside the project and kills a timed-out child process', async () => {
    const spawn = vi.fn(() => fakeChildProcess({ stdout: '', stderr: '', exitCode: 0 }));
    const executor = createRunCommandExecutor({
      projectRoot: 'C:/project',
      spawn,
      now: () => '2026-05-20T00:00:00.000Z',
      ids: { toolResultId: () => 'tool-result-1' },
    });

    await expect(executor.runCommand({ command: 'pwd', cwd: '../outside' }))
      .rejects.toThrow(/outside the project/);
    expect(spawn).not.toHaveBeenCalled();

    const child = fakeChildProcess({ stdout: '', stderr: '', exitCode: null, neverClose: true });
    const timeoutExecutor = createRunCommandExecutor({
      projectRoot: 'C:/project',
      spawn: vi.fn(() => child),
      nowMs: () => 0,
      now: () => '2026-05-20T00:00:00.000Z',
      ids: { toolResultId: () => 'tool-result-1' },
    });

    await expect(timeoutExecutor.runCommand({ command: 'npm test', timeoutMs: 1 }))
      .rejects.toThrow(/timed out/);
    expect(child.kill).toHaveBeenCalled();
  });
});

function toolCall(input: Record<string, unknown>): ToolExecution {
  return {
    toolExecutionId: 'tool-execution-1',
    toolCallId: 'tool-call-1',
    runId: 'run-1',
    stepId: 'step-1',
    toolName: 'run_command',
    input: input as ToolExecution['input'],
    inputPreview: {
      summary: 'run_command',
      targets: [{ kind: 'command', label: String(input.command ?? 'command') }],
      redactionState: 'none',
    },
    capabilities: ['command_run'],
    riskLevel: 'medium',
    sideEffect: 'execute_command',
    status: 'running',
    requestedAt: '2026-05-20T00:00:00.000Z',
  };
}

type OutputChunk = Buffer | string;

function fakeChildProcess(input: {
  stdout: string | OutputChunk[];
  stderr: string | OutputChunk[];
  exitCode: number | null;
  neverClose?: boolean;
}) {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const child = {
    stdout: {
      on: vi.fn((event: string, listener: (chunk: Buffer) => void) => {
        if (event === 'data') {
          emitOutputChunks(input.stdout, listener);
        }
      }),
    },
    stderr: {
      on: vi.fn((event: string, listener: (chunk: Buffer) => void) => {
        if (event === 'data') {
          emitOutputChunks(input.stderr, listener);
        }
      }),
    },
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
      if (event === 'close' && !input.neverClose) {
        queueMicrotask(() => listener(input.exitCode));
      }
      return child;
    }),
    kill: vi.fn(() => {
      for (const listener of listeners.get('close') ?? []) {
        listener(null);
      }
    }),
  };
  return child;
}

function emitOutputChunks(output: string | OutputChunk[], listener: (chunk: Buffer) => void): void {
  const chunks = Array.isArray(output) ? output : output ? [Buffer.from(output)] : [];
  for (const chunk of chunks) {
    listener(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8'));
  }
}


