// @vitest-environment node
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLocalDesktopRuntime } from '../../../src/desktop';
import type { DesktopHostAdapters } from '../../../src/desktop/composition/create-host-adapters';
import { handleRecoveryOperation } from '../../../src/desktop/ipc/recovery.handler';
import { handleToolOperation } from '../../../src/desktop/ipc/tool.handler';
import { handleWorkspaceFilesOperation } from '../../../src/desktop/ipc/workspace-files.handler';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'megumi-plan5-'));
  roots.push(root);
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/a.ts'), 'before', 'utf8');
  return root;
}

function fakeHosts(root: string): DesktopHostAdapters {
  return {
    clipboardHost: { readText: () => '', writeText: () => undefined },
    dialogHost: { openProjectDirectory: async () => root },
    environmentHost: { get: () => undefined },
    fileHost: { readFile: (filePath) => fs.readFile(filePath), writeFile: (filePath, data) => fs.writeFile(filePath, data) },
    megumiHomeHost: { getMegumiHome: () => path.join(root, '.megumi') },
    processHost: { spawn },
    secureStorageHost: { encrypt: (value) => Buffer.from(value), decrypt: (value) => value.toString('utf8'), isAvailable: () => true },
    shellHost: { openPath: async () => undefined },
  };
}

describe('desktop tools permission workspace productization', () => {
  it('lists tools, returns execution history, lists workspace changes, and restores a change set', async () => {
    const root = await tempRoot();
    const runtime = createLocalDesktopRuntime({
      hosts: fakeHosts(root),
      databasePath: ':memory:',
      workspaceRoot: root,
      now: () => '2026-06-20T00:00:00.000Z',
      createId: (prefix, value) => `${prefix}-${value}`,
    });

    const decision = runtime.permissionEvaluator.evaluate({
      decisionId: 'decision-1',
      mode: 'accept_edits',
      operation: 'write',
      actionName: 'write_file',
      target: 'src/a.ts',
      createdAt: '2026-06-20T00:00:00.000Z',
    });
    await runtime.toolExecutionService.execute(
      { id: 'tool-call-1', name: 'write_file', input: { path: 'src/a.ts', content: 'after' } },
      { permissionDecision: decision, runId: 'run-1', sessionId: 'session-1', workspaceId: 'workspace-local', turnIndex: 0 },
    );

    await expect(handleToolOperation('tool.list', {}, { appApi: {} as never, hosts: fakeHosts(root), runtime, getMainWindow: () => undefined }))
      .resolves.toEqual({ tools: expect.arrayContaining([expect.objectContaining({ name: 'write_file' })]) });
    await expect(handleToolOperation('tool.execution.get', { toolCallId: 'tool-call-1' }, { appApi: {} as never, hosts: fakeHosts(root), runtime, getMainWindow: () => undefined }))
      .resolves.toEqual(expect.objectContaining({ execution: expect.objectContaining({ toolCallId: 'tool-call-1', status: 'succeeded' }) }));

    const changeSets = await handleWorkspaceFilesOperation('workspace.changes.list', { runId: 'run-1' }, { appApi: {} as never, hosts: fakeHosts(root), runtime, getMainWindow: () => undefined }) as { changeSets: Array<{ changeSetId: string }> };
    expect(changeSets.changeSets).toEqual([expect.objectContaining({ changeSetId: expect.any(String) })]);

    await expect(handleRecoveryOperation('recovery.restoreWorkspaceChangeSet', {
      changeSetId: changeSets.changeSets[0].changeSetId,
      requestedBy: 'user',
    }, { appApi: {} as never, hosts: fakeHosts(root), runtime, getMainWindow: () => undefined }))
      .resolves.toEqual(expect.objectContaining({ restore: expect.objectContaining({ status: 'completed', restoredCount: 1 }) }));
    await expect(fs.readFile(path.join(root, 'src/a.ts'), 'utf8')).resolves.toBe('before');
    await runtime.stop();
  });
});
