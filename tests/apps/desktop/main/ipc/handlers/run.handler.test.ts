// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Run } from '@megumi/shared/session';
import type { RuntimeEvent } from '@megumi/shared/runtime';

const { handle } = vi.hoisted(() => ({
  handle: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: { handle },
}));

describe('registerRunHandlers', () => {
  beforeEach(() => {
    vi.resetModules();
    handle.mockReset();
  });

  it('registers run event list handler', async () => {
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc');
    const { registerRunHandlers } = await import('@megumi/desktop/main/ipc/handlers/run.handler');

    registerRunHandlers({
      sessionService: {
        listRunsBySession: vi.fn(),
      },
      productRuntime: {
        listRuntimeEventsByRun: vi.fn(),
      },
    });

    expect(handle).toHaveBeenCalledWith(IPC_CHANNELS.run.listBySession, expect.any(Function));
    expect(handle).toHaveBeenCalledWith(IPC_CHANNELS.run.events.list, expect.any(Function));
  });

  it('returns persisted runs for a session', async () => {
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc');
    const { registerRunHandlers } = await import('@megumi/desktop/main/ipc/handlers/run.handler');
    const runs: Run[] = [
      {
        runId: 'run-1',
        sessionId: 'session-1',
        mode: 'default',
        goal: 'Hello',
        status: 'completed',
        createdAt: '2026-05-17T00:00:00.000Z',
        completedAt: '2026-05-17T00:00:05.000Z',
      },
    ];
    const service = {
      sessionService: {
        listRunsBySession: vi.fn(() => runs),
      },
      productRuntime: {
        listRuntimeEventsByRun: vi.fn(),
      },
    };

    registerRunHandlers(service);

    const handler = handle.mock.calls.find(([channel]) => channel === IPC_CHANNELS.run.listBySession)?.[1];
    await expect(handler({}, {
      requestId: 'ipc-run-list-by-session-1',
      payload: { sessionId: 'session-1' },
      meta: {
        channel: IPC_CHANNELS.run.listBySession,
        createdAt: '2026-05-17T00:00:00.000Z',
        source: 'renderer',
      },
    })).resolves.toMatchObject({
      ok: true,
      data: { runs },
      meta: {
        requestId: 'ipc-run-list-by-session-1',
        channel: IPC_CHANNELS.run.listBySession,
      },
    });
    expect(service.sessionService.listRunsBySession).toHaveBeenCalledWith('session-1');
  });

  it('returns runtime events for a run', async () => {
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc');
    const { registerRunHandlers } = await import('@megumi/desktop/main/ipc/handlers/run.handler');
    const events: RuntimeEvent[] = [
      {
        eventId: 'event-1',
        schemaVersion: 1,
        eventType: 'run.completed',
        sessionId: 'session-1',
        runId: 'run-1',
        sequence: 1,
        createdAt: '2026-05-17T00:00:00.000Z',
        source: 'core',
        visibility: 'user',
        persist: 'required',
        payload: {},
      },
    ];
    const service = {
      sessionService: {
        listRunsBySession: vi.fn(),
      },
      productRuntime: {
        listRuntimeEventsByRun: vi.fn(() => events),
      },
    };

    registerRunHandlers(service);

    const handler = handle.mock.calls.find(([channel]) => channel === IPC_CHANNELS.run.events.list)?.[1];
    await expect(handler({}, {
      requestId: 'ipc-run-events-list-1',
      payload: {
        runId: 'run-1',
      },
      meta: {
        channel: IPC_CHANNELS.run.events.list,
        createdAt: '2026-05-17T00:00:00.000Z',
        source: 'renderer',
      },
    })).resolves.toMatchObject({
      ok: true,
      data: {
        events,
      },
      meta: {
        requestId: 'ipc-run-events-list-1',
        channel: IPC_CHANNELS.run.events.list,
      },
    });
    expect(service.productRuntime.listRuntimeEventsByRun).toHaveBeenCalledWith('run-1');
  });
});

