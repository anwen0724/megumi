/* Verifies the Sandbox-backed ToolExecutor lifecycle independently of Product composition. */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { Sandbox, SandboxCapabilities, SandboxScope } from '../../../packages/sandbox/src';
import {
  createSandboxToolExecutor,
  type ToolExecutionResult,
  type ToolExecutor,
} from '../../../packages/tools/src';

const access = {
  fileSystem: { mode: 'workspace' as const },
  process: 'sandboxed' as const,
  network: 'denied' as const,
};
const succeeded: ToolExecutionResult = {
  type: 'succeeded',
  toolName: 'read_file',
  normalizedResult: { kind: 'text', content: 'ok', isError: false, truncated: false },
};

describe('Sandbox ToolExecutor', () => {
  it('opens, tracks, executes, and closes one scope outside Product', async () => {
    const close = vi.fn(async () => ({ status: 'closed' as const }));
    const scope = { capabilities: {} as SandboxCapabilities, files: {}, process: {}, close } as SandboxScope;
    const sandbox: Sandbox = {
      capabilities: () => ({} as SandboxCapabilities),
      open: vi.fn(async () => ({ status: 'opened' as const, scope })),
    };
    const execute = vi.fn(async () => succeeded);
    const trackExecution = vi.fn(async (run: () => Promise<ToolExecutionResult>) => run());
    const executor = createSandboxToolExecutor({
      preflight: (() => ({ status: 'ready', input: {} })) as ToolExecutor['preflight'],
      sandbox,
      policy: { workspaceRoot: 'C:/workspace', maxExecutionTimeMs: 1000, maxOutputBytes: 2000, maxProcessCount: 4 },
      createExecutor: () => ({ execute }),
      trackExecution,
    });

    await expect(executor.execute({ toolName: 'read_file', input: {} }, { executionAccess: access }))
      .resolves.toBe(succeeded);
    expect(sandbox.open).toHaveBeenCalledWith(expect.objectContaining({
      policy: expect.objectContaining({ executionAccess: access }),
    }));
    expect(trackExecution).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('fails closed before opening when Engine did not provide execution access', async () => {
    const sandbox: Sandbox = {
      capabilities: () => ({} as SandboxCapabilities),
      open: vi.fn(),
    };
    const executor = createSandboxToolExecutor({
      preflight: (() => ({ status: 'ready', input: {} })) as ToolExecutor['preflight'],
      sandbox,
      policy: { workspaceRoot: 'C:/workspace', maxExecutionTimeMs: 1000, maxOutputBytes: 2000, maxProcessCount: 4 },
      createExecutor: () => ({ execute: async () => succeeded }),
    });

    await expect(executor.execute({ toolName: 'read_file', input: {} })).resolves.toMatchObject({
      type: 'failed',
      error: { code: 'sandbox_unavailable' },
    });
    expect(sandbox.open).not.toHaveBeenCalled();
  });
});