/* Verifies Sandbox Scope time/output enforcement above the platform process backend. */
// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSandbox, resolveSandboxBackend } from '../../../packages/sandbox/src';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));
const windowsIt = process.platform === 'win32' ? it : it.skip;

async function openScope(
  maxExecutionTimeMs: number,
  maxOutputBytes: number,
  processAccess: 'sandboxed' | 'unrestricted' = 'sandboxed',
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'megumi-sandbox-scope-'));
  roots.push(root);
  const opened = await createSandbox({ backend: resolveSandboxBackend({ platform: 'win32' }) }).open({
    policy: {
      workspaceRoot: root,
      executionAccess: {
        fileSystem: { mode: processAccess === 'sandboxed' ? 'workspace' : 'unrestricted' },
        process: processAccess,
        network: processAccess === 'sandboxed' ? 'denied' : 'unrestricted',
      },
      maxExecutionTimeMs,
      maxOutputBytes,
      maxProcessCount: 4,
    },
  });
  if (opened.status !== 'opened') throw new Error(opened.reason);
  return { root, scope: opened.scope };
}

describe('Sandbox process scope', () => {
  windowsIt('terminates the Job and returns output_limit when combined output exceeds policy', async () => {
    const { root, scope } = await openScope(10_000, 32);
    const controller = new AbortController();
    await expect(scope.process.run(
      { cwd: root, command: "Write-Output ('x' * 200)" },
      { signal: controller.signal, onStdout: () => undefined, onStderr: () => undefined },
    )).rejects.toMatchObject({ code: 'output_limit' });
    await expect(scope.close()).resolves.toEqual({ status: 'closed' });
  }, 30_000);

  windowsIt('terminates the Job and returns tool_timeout when execution exceeds policy', async () => {
    const { root, scope } = await openScope(100, 1_000);
    await expect(scope.process.run(
      { cwd: root, command: 'Start-Sleep -Seconds 30' },
      { signal: new AbortController().signal, onStdout: () => undefined, onStderr: () => undefined },
    )).rejects.toMatchObject({ code: 'tool_timeout' });
    await expect(scope.close()).resolves.toEqual({ status: 'closed' });
  }, 30_000);
});