/* Protects run_command metadata, bounded capture, and cancellation. */

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import {
} from '../../../packages/tools/src';
import { createBuiltInTestHarness } from './built-in-test-harness';
import { createLocalWorkspaceFileAccess, createProcessAdapter, parsedToolContent } from './tool-test-fixtures';

describe('run_command built-in Tool', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-command-'));
  });

  afterEach(() => fs.removeSync(root));

  it('provides explicit shell facts to Permissions metadata and execution diagnostics', async () => {
    const run = vi.fn(async (_request, options) => {
      options.onStdout('output\napiKey=secret-token\n');
      return { exitCode: 0 };
    });
    const tools = createBuiltInTestHarness({
      workspaceFileAccess: createLocalWorkspaceFileAccess(root),
      process: createProcessAdapter({ shellKind: 'powershell', run }),
    });
    expect(tools.get('run_command')).toMatchObject({
      status: 'found',
      tool: {
        definition: {
          inputSchema: {
            properties: { command: { description: 'A command written for Windows PowerShell.' } },
          },
        },
      },
    });
    const routed = tools.route({ toolName: 'run_command', input: { command: 'echo hello' } });
    expect(routed.status).toBe('routed');
    if (routed.status !== 'routed') throw new Error('Expected routed command');
    expect(routed.operations).toEqual(expect.arrayContaining([expect.objectContaining({
        action: 'process.execute',
        resource: expect.objectContaining({ attributes: { shellKind: 'powershell' } }),
      })]));
    const result = await tools.execute({
      toolName: 'run_command', input: { command: 'echo hello' },
    });
    expect(result).toMatchObject({
      type: 'succeeded',
      metadata: { shellKind: 'powershell', executionMethod: 'shell' },
    });
    expect(parsedToolContent(result)).toMatchObject({
      exitCode: 0,
      stdoutPreview: 'output\napiKey=[REDACTED]\n',
    });
    expect(result.normalizedResult.content).not.toContain('secret-token');
    expect(run).toHaveBeenCalledWith(
      { command: 'echo hello', cwd: root },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('bounds stdout and stderr while consuming the complete process stream', async () => {
    const tools = commandTools(root, async (_request, options) => {
      options.onStdout('x'.repeat(100_000));
      options.onStderr('y'.repeat(100_000));
      return { exitCode: 0 };
    });
    const result = await tools.execute({ toolName: 'run_command', input: { command: 'large' } });
    const content = parsedToolContent(result) as { stdoutPreview: string; stderrPreview: string; truncated: boolean };
    expect(Buffer.byteLength(content.stdoutPreview, 'utf8')).toBeLessThanOrEqual(20_000);
    expect(Buffer.byteLength(content.stderrPreview, 'utf8')).toBeLessThanOrEqual(20_000);
    expect(content.truncated).toBe(true);
  });

  it('publishes bounded redacted stdout and stderr without changing the final result', async () => {
    const outputs: Array<{ stream: string; chunk: string; truncated: boolean }> = [];
    const tools = commandTools(root, async (_request, options) => {
      options.onStdout('token=super-secret\n');
      options.onStderr('warning\n');
      return { exitCode: 0, terminationConfirmed: true };
    });
    const execution = await tools.execute(
      { toolName: 'run_command', input: { command: 'inspect' } },
      { onOutput: (output) => outputs.push(output) },
    );
    expect(outputs).toEqual([
      { stream: 'stdout', chunk: 'token=[REDACTED]\n', truncated: false },
      { stream: 'stderr', chunk: 'warning\n', truncated: false },
    ]);
    expect(execution).toMatchObject({
      type: 'succeeded',
      effectReport: { coverage: 'unknown', effects: [], reason: expect.stringContaining('file-effect observation') },
    });
  });
  it('keeps non-zero exit, timeout, cancellation, and spawn failure distinct', async () => {
    const nonZero = commandTools(root, async (_request, options) => {
      options.onStderr('compile failed');
      return { exitCode: 2 };
    });
    await expect(nonZero.execute({
      toolName: 'run_command', input: { command: 'compile' },
    })).resolves.toMatchObject({
      type: 'failed', error: { code: 'command_failed', details: { reason: 'non_zero_exit', exitCode: 2 } },
    });

    const hangingRun = (_request: unknown, options: { signal: AbortSignal }) => (
      new Promise<never>((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('adapter aborted')), { once: true });
      })
    );
    const hanging = commandTools(root, hangingRun as never);
    await expect(hanging.execute({
      toolName: 'run_command', input: { command: 'hang', timeoutMs: 1 },
    })).resolves.toMatchObject({
      type: 'failed', error: { code: 'tool_timeout', details: { reason: 'timeout', timeoutMs: 1 } },
    });

    const controller = new AbortController();
    const cancelled = hanging.execute(
      { toolName: 'run_command', input: { command: 'hang' } },
      { signal: controller.signal },
    );
    controller.abort();
    await expect(cancelled).resolves.toMatchObject({ type: 'failed', error: { code: 'tool_cancelled' } });

    const failed = commandTools(root, async () => { throw new Error(`host path ${root}`); });
    const failedResult = await failed.execute({ toolName: 'run_command', input: { command: 'missing' } });
    expect(failedResult).toMatchObject({
      type: 'failed', error: { code: 'shell_unavailable', message: 'Command process could not be started.', details: { reason: 'spawn_failed' } },
    });
    expect(JSON.stringify(failedResult)).not.toContain(root);
  });
});

function commandTools(
  root: string,
  run: NonNullable<Parameters<typeof createProcessAdapter>[0]>['run'],
) {
  return createBuiltInTestHarness({
    workspaceFileAccess: createLocalWorkspaceFileAccess(root),
    process: createProcessAdapter({ run }),
  });
}
