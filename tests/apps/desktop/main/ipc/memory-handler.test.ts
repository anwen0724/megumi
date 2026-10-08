/* Verifies Memory IPC through real storage, production, and document operations. */
// @vitest-environment node
import type { IpcMainInvokeEvent } from 'electron';
import { expect, it, vi } from 'vitest';
import { fauxAssistantMessage } from '@megumi/ai';
import { registerMemoryHandlers } from '@megumi/desktop/main/ipc/handlers/memory.handler';
import { IPC_CHANNELS } from '@megumi/desktop/main/ipc/channels';
import type { DesktopIpcMain } from '@megumi/desktop/main/adapters/electron-ipc-main-adapter';
import { productionFixture } from '../../../../packages/memory/production-fixture';

function transport(memory: ReturnType<typeof productionFixture>['memory']) {
  const handlers = new Map<string, Parameters<DesktopIpcMain['handle']>[1]>();
  registerMemoryHandlers(
    { host: { memory } },
    {
      ipcMain: {
        handle(channel, handler) {
          handlers.set(channel, handler);
        },
        on: vi.fn(),
      },
    },
  );
  return async (channel: string, payload: unknown) => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`Missing channel: ${channel}`);
    return handler({} as IpcMainInvokeEvent, {
      requestId: 'transport-request',
      payload,
      meta: {
        channel,
        source: 'renderer',
        createdAt: new Date().toISOString(),
      },
    });
  };
}

it('validates requests and exposes versioned editing, source access, and clear through IPC', async () => {
  const f = productionFixture();
  try {
    const invoke = transport(f.memory);
    expect(
      await invoke(IPC_CHANNELS.memory.clearMemory, {
        requestId: 'clear',
        confirmed: false,
      }),
    ).toMatchObject({
      ok: false,
      data: { code: 'ipc_invalid_request' },
    });
    expect(await invoke(IPC_CHANNELS.memory.getRun, { runId: 'missing' })).toMatchObject({
      ok: true,
      data: { status: 'notFound' },
    });
    await f.user('u1');
    f.responses();
    const started = await invoke(IPC_CHANNELS.memory.startGeneration, {
      requestId: 'generate',
      reason: 'manual',
    });
    expect(started).toMatchObject({
      ok: true,
      data: { status: 'started' },
    });
    const status = f.memory.getStatus();
    if (status.status !== 'ok' || !status.memory.recentRuns[0]) throw new Error('Run missing');
    const runId = status.memory.recentRuns[0].runId;
    await f.memory.waitRun({
      runId,
      timeoutMs: 5000,
    });
    expect(await invoke(IPC_CHANNELS.memory.getStatus, {})).toMatchObject({
      ok: true,
      data: { memory: { artifactState: 'ready' } },
    });
    expect(await invoke(IPC_CHANNELS.memory.listDocuments, {})).toMatchObject({
      ok: true,
      data: { documents: expect.arrayContaining([expect.objectContaining({ path: 'MEMORY.md' })]) },
    });
    const document = f.files.read('MEMORY.md');
    if (!document) throw new Error('Document missing');
    expect(await invoke(IPC_CHANNELS.memory.readDocument, { path: document.path })).toMatchObject({
      ok: true,
      data: {
        status: 'found',
        document: { version: document.version },
      },
    });
    expect(
      await invoke(IPC_CHANNELS.memory.searchDocuments, { terms: ['TypeScript'] }),
    ).toMatchObject({
      ok: true,
      data: { hits: expect.arrayContaining([expect.objectContaining({ path: document.path })]) },
    });
    expect(
      await invoke(IPC_CHANNELS.memory.updateDocument, {
        requestId: 'edit',
        path: document.path,
        expectedVersion: document.version,
        content: document.content.replace('Use TypeScript', 'Use minimal TypeScript'),
      }),
    ).toMatchObject({
      ok: true,
      data: { status: 'saved' },
    });
    expect(
      await invoke(IPC_CHANNELS.memory.updateDocument, {
        requestId: 'stale',
        path: document.path,
        expectedVersion: document.version,
        content: document.content,
      }),
    ).toMatchObject({
      ok: false,
      data: { code: 'VERSION_CONFLICT' },
    });
    expect(
      await invoke(IPC_CHANNELS.memory.readDocument, { path: '../settings.json' }),
    ).toMatchObject({
      ok: false,
      data: { code: 'PATH_DENIED' },
    });
    const source = f.sources.readSnapshot('s1');
    if (source.status !== 'found') throw new Error('Source missing');
    expect(
      await invoke(IPC_CHANNELS.memory.readSource, { sourceRef: source.snapshot.sourceRef }),
    ).toMatchObject({
      ok: true,
      data: {
        status: 'found',
        sessionId: 's1',
      },
    });
    expect(await invoke(IPC_CHANNELS.memory.listSources, {})).toMatchObject({
      ok: true,
      data: {
        sources: [
          expect.objectContaining({
            sessionId: 's1',
            eligibility: 'eligible',
          }),
        ],
      },
    });
    f.responses();
    expect(
      await invoke(IPC_CHANNELS.memory.setSourceEligibility, {
        requestId: 'exclude',
        sessionId: 's1',
        eligibility: 'excluded',
        expectedVersion: 0,
      }),
    ).toMatchObject({
      ok: true,
      data: { status: 'saved' },
    });
    await vi.waitFor(() =>
      expect(f.memory.getStatus()).toMatchObject({
        memory: {
          artifactState: 'ready',
          dirty: false,
        },
      }),
    );
    expect(
      await invoke(IPC_CHANNELS.memory.clearMemory, {
        requestId: 'clear',
        confirmed: true,
      }),
    ).toMatchObject({
      ok: true,
      data: { status: 'started' },
    });
    await vi.waitFor(() =>
      expect(f.memory.getStatus()).toMatchObject({ memory: { artifactState: 'empty' } }),
    );
    expect(f.sources.readSnapshot('s1')).toMatchObject({ status: 'found' });
  } finally {
    await f.dispose();
  }
});

it('returns a failed run as successful query data and preserves mutation rejection codes', async () => {
  const f = productionFixture();
  try {
    const invoke = transport(f.memory);
    await f.user('u1');
    f.responses();
    await f.generate();
    const document = f.files.read('MEMORY.md');
    if (!document) throw new Error('Document missing');
    f.memory.updateDocument({
      requestId: 'mark-dirty',
      path: document.path,
      content: document.content,
      expectedVersion: document.version,
    });
    f.provider.setResponses([fauxAssistantMessage('No valid output produced.')]);
    const run = await f.generate('fail-consolidation');
    expect(run.status).toBe('failed');
    expect(await invoke(IPC_CHANNELS.memory.getRun, { runId: run.runId })).toMatchObject({
      ok: true,
      data: {
        status: 'failed',
        runId: run.runId,
      },
    });
    expect(
      await invoke(IPC_CHANNELS.memory.cancelRun, {
        requestId: 'cancel',
        runId: run.runId,
      }),
    ).toMatchObject({
      ok: true,
      data: { status: 'alreadyFinished' },
    });
    expect(
      await invoke(IPC_CHANNELS.memory.startGeneration, {
        requestId: 'retry',
        reason: 'retry',
        failedJobId: 'missing',
      }),
    ).toMatchObject({
      ok: false,
      data: { code: 'INVALID_ARGUMENT' },
    });
  } finally {
    await f.dispose();
  }
});
