/* Verifies process termination failure at the platform process boundary. */
// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { createSandboxWithBackend, resolveSandboxBackend } from '@megumi/agent/sandbox/sandbox-scope';
import { SandboxProcessError } from '@megumi/agent/sandbox/windows-process';

afterEach(() => vi.useRealTimers());

it('does not hide unconfirmed process termination behind its execution timeout', async () => {
  vi.useFakeTimers();
  const sandbox = createSandboxWithBackend({
    ...resolveSandboxBackend({ platform: 'win32' }),
    createProcess: () => ({
      shellKind: 'powershell', shellName: 'PowerShell', executionMethod: 'shell',
      run: (_request, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new SandboxProcessError('termination_unconfirmed', 'Process is still active.')), { once: true });
      }),
    }),
  });
  const opened = await sandbox.open({ policy: {
    workspaceRoot: process.cwd(), maxExecutionTimeMs: 100, maxOutputBytes: 20_000, maxProcessCount: 16,
    executionAccess: { fileSystem: { mode: 'workspace' }, process: 'sandboxed', network: 'denied' },
  } });
  if (opened.status !== 'opened') throw new Error('Scope unavailable.');
  const running = opened.scope.process.run({ command: 'Get-Content note.txt', cwd: process.cwd() }, {
    signal: new AbortController().signal, onStdout() {}, onStderr() {},
  });
  await Promise.all([
    expect(running).rejects.toMatchObject({ code: 'termination_unconfirmed' }),
    vi.advanceTimersByTimeAsync(101),
  ]);
  expect(await opened.scope.close()).toEqual({ status: 'termination_unconfirmed' });
});
