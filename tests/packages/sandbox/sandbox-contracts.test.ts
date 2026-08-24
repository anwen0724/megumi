/* Verifies Sandbox capability disclosure and scope ownership contracts. */

import { describe, expect, it } from 'vitest';
import { executeSandboxScope } from '../../../packages/agent/sandbox/src';
import type {
  Sandbox,
  SandboxCapabilities,
  SandboxPolicy,
  SandboxScope,
} from '../../../packages/agent/sandbox/src';

describe('Sandbox contracts', () => {
  it('requires explicit capability disclosure before opening a scope', async () => {
    const capabilities: SandboxCapabilities = {
      platform: 'win32',
      shellKind: 'powershell',
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
    const policy: SandboxPolicy = {
      workspaceRoot: 'C:/workspace',
      executionAccess: {
        fileSystem: { mode: 'workspace' },
        process: 'sandboxed',
        network: 'denied',
      },
      maxExecutionTimeMs: 1_000,
      maxOutputBytes: 2_000,
      maxProcessCount: 4,
    };
    const scope = { capabilities, files: {}, process: {}, close: async () => ({ status: 'closed' as const }) } as SandboxScope;
    const sandbox: Sandbox = {
      capabilities: () => capabilities,
      open: async (request) => request.policy === policy
        ? { status: 'opened', scope }
        : { status: 'unavailable', reason: 'unexpected policy' },
    };

    expect(sandbox.capabilities()).toEqual(capabilities);
    await expect(sandbox.open({ policy })).resolves.toEqual({ status: 'opened', scope });
  });
  it('owns scope close on success and failure', async () => {
    let closeCount = 0;
    const scope = {
      capabilities: {} as SandboxCapabilities,
      files: {},
      process: {},
      close: async () => { closeCount += 1; return { status: 'closed' as const }; },
    } as SandboxScope;
    const sandbox: Sandbox = {
      capabilities: () => ({} as SandboxCapabilities),
      open: async () => ({ status: 'opened', scope }),
    };
    const policy: SandboxPolicy = {
      workspaceRoot: 'C:/workspace',
      executionAccess: {
        fileSystem: { mode: 'workspace' },
        process: 'sandboxed',
        network: 'denied',
      },
      maxExecutionTimeMs: 1_000,
      maxOutputBytes: 2_000,
      maxProcessCount: 4,
    };

    await expect(executeSandboxScope({ sandbox, open: { policy }, execute: async () => 'ok' }))
      .resolves.toEqual({ status: 'completed', value: 'ok' });
    await expect(executeSandboxScope({ sandbox, open: { policy }, execute: async () => { throw new Error('failed'); } }))
      .rejects.toThrow('failed');
    expect(closeCount).toBe(2);
  });
});