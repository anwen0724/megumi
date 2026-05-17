// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';

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
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc-channels');
    const { registerRunHandlers } = await import('@megumi/desktop/main/ipc/handlers/run.handler');

    registerRunHandlers({
      listRuntimeEventsByRun: vi.fn(),
    });

    expect(handle).toHaveBeenCalledWith(IPC_CHANNELS.run.events.list, expect.any(Function));
  });

  it('returns runtime events for a run', async () => {
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc-channels');
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
      listRuntimeEventsByRun: vi.fn(() => events),
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
    expect(service.listRuntimeEventsByRun).toHaveBeenCalledWith('run-1');
  });
});
