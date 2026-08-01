/* Verifies Sandbox capability disclosure and scope ownership contracts. */

import { describe, expect, it } from 'vitest';
import type {
  Sandbox,
  SandboxCapabilities,
  SandboxPolicy,
  SandboxScope,
} from '../../../packages/sandbox/src';

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
      allowNetwork: false,
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
});