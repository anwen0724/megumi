/* Protects run_command metadata, bounded capture, cancellation, and Skill script mapping. */

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import {
  createTools,
  mapSkillScriptExecutionRequestToRunCommandInput,
} from '../../../packages/tools/src';
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
    const tools = createTools({
      workspaceFileAccess: createLocalWorkspaceFileAccess(root),
      process: createProcessAdapter({ shellKind: 'powershell', run }),
    });
    expect(tools.catalog.get({ toolName: 'run_command' })).toMatchObject({
      status: 'found',
      tool: {
        definition: {
          inputSchema: {
            properties: { command: { description: 'A command written for Windows PowerShell 5.1.' } },
          },
        },
      },
    });
    expect(tools.catalog.get({ toolName: 'run_command' })).toMatchObject({
      status: 'found',
      tool: { definition: { permissionMetadata: {
        shellKind: 'powershell', executionMethod: 'shell',
      } } },
    });
    const result = await tools.executor.execute({
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
    const result = await tools.executor.execute({ toolName: 'run_command', input: { command: 'large' } });
    const content = parsedToolContent(result) as { stdoutPreview: string; stderrPreview: string; truncated: boolean };
    expect(Buffer.byteLength(content.stdoutPreview, 'utf8')).toBeLessThanOrEqual(20_000);
    expect(Buffer.byteLength(content.stderrPreview, 'utf8')).toBeLessThanOrEqual(20_000);
    expect(content.truncated).toBe(true);
  });

  it('keeps non-zero exit, timeout, cancellation, and spawn failure distinct', async () => {
    const nonZero = commandTools(root, async (_request, options) => {
      options.onStderr('compile failed');
      return { exitCode: 2 };
    });
    await expect(nonZero.executor.execute({
      toolName: 'run_command', input: { command: 'compile' },
    })).resolves.toMatchObject({
      type: 'failed', error: { code: 'tool_execution_failed', details: { reason: 'non_zero_exit', exitCode: 2 } },
    });

    const hangingRun = (_request: unknown, options: { signal: AbortSignal }) => (
      new Promise<never>((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('adapter aborted')), { once: true });
      })
    );
    const hanging = commandTools(root, hangingRun as never);
    await expect(hanging.executor.execute({
      toolName: 'run_command', input: { command: 'hang', timeoutMs: 1 },
    })).resolves.toMatchObject({
      type: 'failed', error: { code: 'tool_execution_failed', details: { reason: 'timeout', timeoutMs: 1 } },
    });

    const controller = new AbortController();
    const cancelled = hanging.executor.execute(
      { toolName: 'run_command', input: { command: 'hang' } },
      { signal: controller.signal },
    );
    controller.abort();
    await expect(cancelled).resolves.toMatchObject({ type: 'failed', error: { code: 'tool_cancelled' } });

    const failed = commandTools(root, async () => { throw new Error(`host path ${root}`); });
    const failedResult = await failed.executor.execute({ toolName: 'run_command', input: { command: 'missing' } });
    expect(failedResult).toMatchObject({
      type: 'failed', error: { message: 'Command process could not be started.', details: { reason: 'spawn_failed' } },
    });
    expect(JSON.stringify(failedResult)).not.toContain(root);
  });

  it.each([
    ['powershell', "& 'C:\\skills\\review check.ps1' '--name' 'A''B'"],
    ['cmd', 'call "C:\\skills\\review check.ps1" "--name" "A\'B"'],
    ['posix_shell', "'C:\\skills\\review check.ps1' '--name' 'A'\\''B'"],
  ] as const)('maps Skill scripts safely for %s', (shellKind, expectedCommand) => {
    const mapped = mapSkillScriptExecutionRequestToRunCommandInput({
      shellKind,
      execution: {
        skillPath: 'C:/skills/review/SKILL.md',
        scriptName: 'check',
        scriptPath: 'C:\\skills\\review check.ps1',
        args: ['--name', "A'B"],
        approvalSummary: 'Run review check',
      },
    });
    expect(mapped.command).toBe(expectedCommand);
  });

  it('preserves prepared Skill script identity in safe execution metadata', async () => {
    const run = vi.fn(async () => ({ exitCode: 0 }));
    const tools = commandTools(root, run);
    const input = mapSkillScriptExecutionRequestToRunCommandInput({
      shellKind: 'powershell',
      execution: {
        skillPath: 'C:/skills/check/SKILL.md',
        scriptName: 'check',
        scriptPath: 'C:/skills/check/scripts/check.ps1',
        args: ['--watch'],
        approvalSummary: 'Run Skill check',
      },
    });
    const result = await tools.executor.execute({ toolName: 'run_command', input });
    expect(result).toMatchObject({
      type: 'succeeded',
      metadata: {
        source: 'skill',
        skillPath: 'C:/skills/check/SKILL.md',
        scriptName: 'check',
        approvalSummary: 'Run Skill check',
        shellKind: 'powershell',
      },
    });
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ command: "& 'C:/skills/check/scripts/check.ps1' '--watch'" }),
      expect.any(Object),
    );
  });
});

function commandTools(
  root: string,
  run: NonNullable<Parameters<typeof createProcessAdapter>[0]>['run'],
) {
  return createTools({
    workspaceFileAccess: createLocalWorkspaceFileAccess(root),
    process: createProcessAdapter({ run }),
  });
}
