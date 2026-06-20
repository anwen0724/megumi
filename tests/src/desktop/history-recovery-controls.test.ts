// @vitest-environment node
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDesktopAppApi, createLocalDesktopRuntime } from '../../../src/desktop';
import { handleRecoveryOperation } from '../../../src/desktop/ipc/handlers/recovery.handler';
import type { DesktopHostAdapters } from '../../../src/desktop/composition/create-host-adapters';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'megumi-history-controls-'));
  roots.push(root);
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

describe('history recovery controls', () => {
  it('lists terminal recoverable runs without exposing active running runs', async () => {
    const root = await tempRoot();
    const runtime = createLocalDesktopRuntime({
      hosts: fakeHosts(root),
      databasePath: ':memory:',
      workspaceRoot: root,
      now: () => '2026-06-20T00:00:00.000Z',
      createId: (prefix, value) => `${prefix}-${value}`,
    });
    const appApi = createDesktopAppApi({ agentRuntime: runtime.agentRuntime });
    const session = runtime.sessionManager.createSession({ idSeed: '1', title: 'Recover me', workspaceId: 'workspace-1' });
    const { run: runningRun } = runtime.sessionManager.recordRun({
      idSeed: '1',
      sourceEntryIdSeed: 'run-1',
      sessionId: session.id,
      inputSummary: 'recover input',
      status: 'running',
    });
    const { run: failedRun } = runtime.sessionManager.recordRun({
      idSeed: '2',
      sourceEntryIdSeed: 'run-2',
      sessionId: session.id,
      inputSummary: 'failed input',
      status: 'failed',
    });

    const context = { appApi, hosts: fakeHosts(root), runtime, getMainWindow: () => undefined };

    await expect(handleRecoveryOperation('recovery.listRecoverableRuns', {}, context)).resolves.toEqual({
      runs: [expect.objectContaining({ runId: failedRun.id, status: 'failed', reason: 'failed' })],
    });
    await expect(handleRecoveryOperation('recovery.cancel', {
      runId: runningRun.id,
      sessionId: session.id,
      workspaceId: 'workspace-1',
      reason: 'user_requested',
    }, context)).resolves.toEqual(expect.objectContaining({
      runId: runningRun.id,
      sessionId: session.id,
      status: 'cancelled',
    }));
    expect(runtime.recoveryRepository.listCancelRequestsByRun(runningRun.id)).toHaveLength(1);
    expect(runtime.sessionRepository.getRunRecord(runningRun.id)?.status).toBe('cancelled');
    await runtime.stop();
  });

  it('records rerun source facts before retrying an existing run', async () => {
    const root = await tempRoot();
    const runtime = createLocalDesktopRuntime({
      hosts: fakeHosts(root),
      databasePath: ':memory:',
      workspaceRoot: root,
      ai: {
        stream() {
          return {
            async *[Symbol.asyncIterator]() {
              yield { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'retried' }], stopReason: 'stop' } };
            },
            async result() {
              return { role: 'assistant', content: [{ type: 'text', text: 'retried' }], stopReason: 'stop' };
            },
          } as never;
        },
      },
      now: () => '2026-06-20T00:00:00.000Z',
      createId: (prefix, value) => `${prefix}-${value}`,
    });
    const appApi = createDesktopAppApi({ agentRuntime: runtime.agentRuntime });
    const session = runtime.sessionManager.createSession({ idSeed: '1', title: 'Retry me', workspaceId: 'workspace-1' });
    const { run } = runtime.sessionManager.recordRun({
      idSeed: '1',
      sourceEntryIdSeed: 'run-1',
      sessionId: session.id,
      inputSummary: 'retry input',
      status: 'failed',
    });

    const response = await handleRecoveryOperation('recovery.retry', {
      runId: run.id,
      sessionId: session.id,
      workspaceId: 'workspace-1',
      reason: 'failed',
      retryKind: 'manual_rerun',
    }, { appApi, hosts: fakeHosts(root), runtime, getMainWindow: () => undefined });

    expect(response).toMatchObject({ status: 'completed', sessionId: session.id });
    expect(runtime.recoveryRepository.listRetryRequestsByRun(run.id)).toHaveLength(1);
    expect(runtime.sessionRepository.listRetryAttempts(session.id).some((attempt) => attempt.mode === 'rerun')).toBe(true);
    await runtime.stop();
  });
});
