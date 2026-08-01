/* Verifies platform Backend resolution and the generic Sandbox seam. */
// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createSandbox,
  createUnsupportedSandboxBackend,
  resolveSandboxBackend,
  type SandboxBackend,
  type SandboxCapabilities,
  type SandboxProcess,
} from '../../../packages/sandbox/src';

const workspaceAccess = {
  fileSystem: { mode: 'workspace' as const },
  process: 'sandboxed' as const,
  network: 'denied' as const,
};

describe('Sandbox Backend', () => {
  it('runs the generic Scope through an injected Backend', async () => {
    const capabilities: SandboxCapabilities = {
      platform: 'win32',
      shellKind: 'powershell',
      shellName: 'Test PowerShell',
      workspaceEffectObservation: false,
      fileReadBoundary: true,
      fileWriteBoundary: true,
      environmentIsolation: true,
      networkIsolation: true,
      processTreeTermination: true,
      timeLimit: true,
      outputLimit: true,
      processCountLimit: true,
      cpuLimit: false,
      memoryLimit: false,
    };
    const processAdapter: SandboxProcess = {
      shellKind: 'powershell',
      shellName: 'Test PowerShell',
      executionMethod: 'shell',
      run: vi.fn(async () => ({ exitCode: 0, terminationConfirmed: true as const })),
    };
    const backend: SandboxBackend = {
      platform: 'win32',
      capabilities: vi.fn(() => capabilities),
      createProcess: vi.fn(() => processAdapter),
    };
    const sandbox = createSandbox({ backend });
    const opened = await sandbox.open({
      policy: {
        workspaceRoot: process.cwd(),
        executionAccess: workspaceAccess,
        maxExecutionTimeMs: 1_000,
        maxOutputBytes: 2_000,
        maxProcessCount: 4,
      },
    });

    expect(sandbox.capabilities()).toEqual(capabilities);
    expect(backend.capabilities).toHaveBeenCalledWith({ executionAccess: workspaceAccess });
    expect(backend.createProcess).toHaveBeenCalledWith(expect.objectContaining({
      workspaceRoot: process.cwd(),
      executionAccess: workspaceAccess,
      maxProcessCount: 4,
    }));
    expect(opened.status).toBe('opened');
  });

  it('resolves Windows to the implemented Backend without hard-coding a version label', () => {
    const backend = resolveSandboxBackend({ platform: 'win32' });
    expect(backend.platform).toBe('win32');
    expect(backend.capabilities({ executionAccess: workspaceAccess })).toMatchObject({
      platform: 'win32',
      shellKind: 'powershell',
      shellName: 'Windows PowerShell',
    });
  });

  it.each(['darwin', 'linux'] as const)('resolves unsupported %s without a POSIX fallback', async (platform) => {
    const backend = resolveSandboxBackend({ platform });
    expect(backend).toMatchObject({ platform });
    expect(backend.capabilities({ executionAccess: {
      fileSystem: { mode: 'unrestricted' },
      process: 'unrestricted',
      network: 'unrestricted',
    } })).toMatchObject({
      platform, shellKind: undefined, shellName: undefined,
      fileReadBoundary: true, fileWriteBoundary: true, processTreeTermination: false,
    });
    await expect(backend.createProcess({
      workspaceRoot: process.cwd(),
      executionAccess: workspaceAccess,
      maxProcessCount: 4,
    }).run(
      { cwd: process.cwd(), command: 'echo unavailable' },
      { signal: new AbortController().signal, onStdout: () => undefined, onStderr: () => undefined },
    )).rejects.toMatchObject({ code: 'sandbox_unavailable' });
  });

  it('keeps generic Scope source independent from Windows and platform selection', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'packages/sandbox/src/sandbox-scope.ts'), 'utf8');
    expect(source).not.toContain('windows-');
    expect(source).not.toContain("'win32'");
    expect(source).not.toContain('process.platform');
  });

  it('exposes an explicit unsupported Backend factory for host tests', () => {
    expect(createUnsupportedSandboxBackend({ platform: 'freebsd' }).platform).toBe('freebsd');
  });
});