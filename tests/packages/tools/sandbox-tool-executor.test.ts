/* Verifies the Sandbox execution boundary for an already-routed and authorized ToolInvocation. */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { Sandbox, SandboxCapabilities, SandboxScope } from '../../../packages/sandbox/src';
import type { ToolExecutionResult, ToolInvocation } from '../../../packages/tools/src';
import { executeSandboxToolInvocation } from '../../../packages/tools/src/sandbox-tool-executor';

const access = {
  fileSystem: { mode: 'workspace' as const },
  process: 'sandboxed' as const,
  network: 'denied' as const,
};
const invocation: ToolInvocation = {
  invocationId: 'model-call:1:tool-call:1',
  runId: 'run:1',
  sessionId: 'session:1',
  workspaceId: 'workspace:1',
  modelCallId: 'model-call:1',
  toolCallId: 'tool-call:1',
  toolName: 'read_file',
  toolIdentity: {
    sourceId: 'built_in', namespace: 'megumi', sourceToolName: 'read_file', registeredToolName: 'read_file',
  },
  input: { path: 'notes.md' },
};
const succeeded: ToolExecutionResult = {
  type: 'succeeded',
  toolName: 'read_file',
  normalizedResult: { kind: 'text', content: 'ok', isError: false, truncated: false },
};

describe('Sandbox Tool invocation execution', () => {
  it('opens, tracks, executes, and closes one scope outside Product', async () => {
    const close = vi.fn(async () => ({ status: 'closed' as const }));
    const scope = { capabilities: {} as SandboxCapabilities, files: {}, process: {}, close } as SandboxScope;
    const sandbox: Sandbox = {
      capabilities: () => ({} as SandboxCapabilities),
      open: vi.fn(async () => ({ status: 'opened' as const, scope })),
    };
    const execute = vi.fn(async () => succeeded);
    const trackToolExecution = vi.fn(async ({ execute: tracked }: { execute: () => Promise<ToolExecutionResult> }) => tracked());

    await expect(executeSandboxToolInvocation({
      sandbox,
      executionPolicy: { maxExecutionTimeMs: 1000, maxOutputBytes: 2000, maxProcessCount: 4 },
      workspaceChanges: { trackToolExecution },
      workspaceRoot: 'C:/workspace',
      invocation,
      skills: { useSkill: vi.fn() } as never,
      webFetch: { fetch: vi.fn() } as never,
      options: { executionAccess: access },
      execute,
    })).resolves.toBe(succeeded);
    expect(sandbox.open).toHaveBeenCalledWith(expect.objectContaining({
      policy: expect.objectContaining({ executionAccess: access }),
    }));
    expect(trackToolExecution).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('returns a stable failure when the Sandbox scope cannot open', async () => {
    const sandbox: Sandbox = {
      capabilities: () => ({} as SandboxCapabilities),
      open: vi.fn(async () => ({ status: 'unavailable' as const, reason: 'Sandbox unavailable.' })),
    };
    await expect(executeSandboxToolInvocation({
      sandbox,
      executionPolicy: { maxExecutionTimeMs: 1000, maxOutputBytes: 2000, maxProcessCount: 4 },
      workspaceChanges: { trackToolExecution: async ({ execute }) => execute() },
      workspaceRoot: 'C:/workspace',
      invocation,
      skills: { useSkill: vi.fn() } as never,
      webFetch: { fetch: vi.fn() } as never,
      options: { executionAccess: access },
      execute: async () => succeeded,
    })).resolves.toMatchObject({
      type: 'failed',
      error: { code: 'sandbox_unavailable', message: 'Sandbox unavailable.' },
    });
  });
});
