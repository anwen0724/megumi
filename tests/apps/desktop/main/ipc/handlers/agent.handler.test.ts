// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import { registerAgentHandlers } from '@megumi/desktop/main/ipc/handlers/agent.handler';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

describe('registerAgentHandlers', () => {
  beforeEach(async () => {
    const { ipcMain } = await import('electron');
    vi.mocked(ipcMain.handle).mockClear();
  });

  it('registers agent lifecycle channels', async () => {
    const { ipcMain } = await import('electron');

    registerAgentHandlers({
      createSession: vi.fn(),
      listSessions: vi.fn(),
      startRun: vi.fn(),
    });

    expect(ipcMain.handle).toHaveBeenCalledWith(IPC_CHANNELS.agent.session.create, expect.any(Function));
    expect(ipcMain.handle).toHaveBeenCalledWith(IPC_CHANNELS.agent.session.list, expect.any(Function));
    expect(ipcMain.handle).toHaveBeenCalledWith(IPC_CHANNELS.agent.run.start, expect.any(Function));
  });

  it('forwards agent run lifecycle events to the renderer runtime event channel', async () => {
    const { ipcMain } = await import('electron');
    const event: RuntimeEvent = {
      eventId: 'event-1',
      schemaVersion: 1,
      eventType: 'run.completed',
      runId: 'run-1',
      sessionId: 'session-1',
      sequence: 1,
      createdAt: '2026-05-15T00:00:00.000Z',
      source: 'core',
      visibility: 'user',
      persist: 'required',
      payload: {},
    };

    registerAgentHandlers({
      createSession: vi.fn(),
      listSessions: vi.fn(),
      startRun: vi.fn(async () => ({
        run: {
          runId: 'run-1',
          sessionId: 'session-1',
          mode: 'chat',
          goal: 'Answer',
          status: 'completed' as const,
          createdAt: '2026-05-15T00:00:00.000Z',
          completedAt: '2026-05-15T00:00:00.000Z',
        },
        events: [event],
      })),
    });

    const runHandler = vi.mocked(ipcMain.handle).mock.calls.find(
      ([channel]) => channel === IPC_CHANNELS.agent.run.start,
    )?.[1] as unknown as (
      (event: { sender: { send: ReturnType<typeof vi.fn> } }, request: unknown) => Promise<unknown>
    );
    const sender = { send: vi.fn() };

    await runHandler(
      { sender },
      {
        requestId: 'ipc-agent-run-start-1',
        payload: {
          sessionId: 'session-1',
          goal: 'Answer',
          mode: 'chat',
          createdAt: '2026-05-15T00:00:00.000Z',
        },
        meta: {
          channel: IPC_CHANNELS.agent.run.start,
          createdAt: '2026-05-15T00:00:00.000Z',
          source: 'renderer',
        },
      },
    );

    expect(sender.send).toHaveBeenCalledWith(IPC_CHANNELS.runtime.event, event);
  });
});
