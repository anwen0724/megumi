/* Verifies the real Windows AppContainer and Job Object command boundary. */
// @vitest-environment node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createWindowsSandboxProcess, WINDOWS_SANDBOX_CAPABILITIES } from '../../../packages/sandbox/src';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

async function workspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'megumi-windows-sandbox-'));
  roots.push(root);
  return root;
}

async function run(
  root: string,
  command: string,
  signal = new AbortController().signal,
  isolation: 'restricted' | 'unrestricted' = 'restricted',
) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const result = await createWindowsSandboxProcess({ workspaceRoot: root, maxProcessCount: 4, isolation }).run(
    { command, cwd: root },
    { signal, onStdout: (chunk) => stdout.push(String(chunk)), onStderr: (chunk) => stderr.push(String(chunk)) },
  );
  return { result, stdout: stdout.join(''), stderr: stderr.join('') };
}

const windowsIt = process.platform === 'win32' ? it : it.skip;

describe('Windows Sandbox process', () => {
  windowsIt('discloses every mandatory execution capability', () => {
    expect(WINDOWS_SANDBOX_CAPABILITIES).toMatchObject({
      fileReadBoundary: true, fileWriteBoundary: true, environmentIsolation: true,
      networkIsolation: true, processTreeTermination: true, timeLimit: true,
      outputLimit: true, processCountLimit: true,
    });
  });

  windowsIt('runs PowerShell with a sanitized environment and no network capability', async () => {
    const root = await workspace();
    process.env.MEGUMI_TEST_SECRET = 'must-not-cross';
    try {
      const execution = await run(root, "$secret = [string]$env:MEGUMI_TEST_SECRET; try { $client = New-Object Net.Sockets.TcpClient; $client.Connect('1.1.1.1', 53); $network = 'open' } catch { $network = 'denied' }; Write-Output ('secret=' + $secret); Write-Output ('network=' + $network)");
      expect(execution.result).toEqual({ exitCode: 0, terminationConfirmed: true });
      expect(execution.stdout).toContain('secret=');
      expect(execution.stdout).not.toContain('must-not-cross');
      expect(execution.stdout).toContain('network=denied');
    } finally { delete process.env.MEGUMI_TEST_SECRET; }
  }, 30_000);

  windowsIt('allows Workspace writes and denies writes outside it', async () => {
    const root = await workspace();
    const outside = path.join(os.tmpdir(), `megumi-outside-${Date.now()}.txt`);
    const command = `$ErrorActionPreference='Stop'; Set-Content -LiteralPath 'inside.txt' -Value 'inside'; try { Set-Content -LiteralPath '${outside.replaceAll("'", "''")}' -Value 'outside'; 'outside=open' } catch { 'outside=denied' }`;
    const execution = await run(root, command);
    expect({ stdout: execution.stdout, stderr: execution.stderr, result: execution.result }).toEqual({ stdout: expect.stringContaining('outside=denied'), stderr: '', result: { exitCode: 0, terminationConfirmed: true } });
    await expect(fs.readFile(path.join(root, 'inside.txt'), 'utf8')).resolves.toContain('inside');
    await expect(fs.stat(outside)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 30_000);

  windowsIt('denies reading ordinary user files outside the Workspace', async () => {
    const root = await workspace();
    const outside = path.join(os.tmpdir(), `megumi-outside-read-${Date.now()}.txt`);
    await fs.writeFile(outside, 'outside-secret', 'utf8');
    try {
      const escaped = outside.replaceAll("'", "''");
      const execution = await run(root, `$ErrorActionPreference='Stop'; try { Get-Content -LiteralPath '${escaped}'; 'outside-read=open' } catch { 'outside-read=denied' }`);
      expect(execution.result).toEqual({ exitCode: 0, terminationConfirmed: true });
      expect(execution.stdout).toContain('outside-read=denied');
      expect(execution.stdout).not.toContain('outside-secret');
    } finally { await fs.rm(outside, { force: true }); }
  }, 30_000);
  windowsIt('runs an unrestricted command outside the Workspace while keeping Job completion', async () => {
    const root = await workspace();
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'megumi-unrestricted-cwd-'));
    roots.push(outside);
    const stdout: string[] = [];
    const processAdapter = createWindowsSandboxProcess({
      workspaceRoot: root,
      maxProcessCount: 4,
      isolation: 'unrestricted',
    });
    const result = await processAdapter.run(
      { command: "Write-Output (Get-Location).Path", cwd: outside },
      { signal: new AbortController().signal, onStdout: (chunk) => stdout.push(String(chunk)), onStderr: () => undefined },
    );
    expect(result).toEqual({ exitCode: 0, terminationConfirmed: true });
    expect(stdout.join('').toLowerCase()).toContain(outside.toLowerCase());
  }, 30_000);
  windowsIt('terminates the complete Job when cancelled', async () => {
    const root = await workspace();
    const controller = new AbortController();
    const marker = path.join(root, 'child-finished.txt').replaceAll("'", "''");
    const pending = run(root, `Start-Process powershell.exe -ArgumentList '-NoProfile','-Command','Start-Sleep -Seconds 2; Set-Content -LiteralPath ''${marker}'' -Value done'; Start-Sleep -Seconds 30`, controller.signal);
    setTimeout(() => controller.abort(), 250);
    await expect(pending).rejects.toMatchObject({ code: 'tool_cancelled' });
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    await expect(fs.stat(path.join(root, 'child-finished.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  }, 30_000);
});