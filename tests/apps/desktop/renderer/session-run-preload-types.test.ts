// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import { createRendererRuntimeIpcRequest } from '@megumi/desktop/renderer/shared/ipc/runtime-request';
import type { MegumiAPI } from '@megumi/desktop/preload/types';

describe('session and run preload API shape', () => {
  it('supports typed primary session and run methods on window.megumi', async () => {
    const api: Pick<MegumiAPI, 'session' | 'run'> = {
      session: {
        create: vi.fn(),
        list: vi.fn(),
        message: {
          send: vi.fn(),
          cancel: vi.fn(),
        },
      },
      run: {
        events: {
          list: vi.fn(),
        },
      },
    };

    const createRequest = createRendererRuntimeIpcRequest(IPC_CHANNELS.session.create, {
      title: 'Session lifecycle',
      createdAt: '2026-05-17T00:00:00.000Z',
    });
    const sendRequest = createRendererRuntimeIpcRequest(IPC_CHANNELS.session.message.send, {
      providerId: 'deepseek' as const,
      modelId: 'deepseek-v4-flash',
      messages: [
        {
          id: 'message-1',
          role: 'user' as const,
          content: 'Hello',
          createdAt: '2026-05-17T00:00:00.000Z',
        },
      ],
      createdAt: '2026-05-17T00:00:00.000Z',
    });
    const eventsRequest = createRendererRuntimeIpcRequest(IPC_CHANNELS.run.events.list, {
      runId: 'run-1',
    });

    await api.session.create(createRequest);
    await api.session.message.send(sendRequest);
    await api.run.events.list(eventsRequest);

    expect(api.session.create).toHaveBeenCalledWith(expect.objectContaining({
      meta: expect.objectContaining({
        channel: IPC_CHANNELS.session.create,
      }),
    }));
    expect(api.session.message.send).toHaveBeenCalledWith(expect.objectContaining({
      meta: expect.objectContaining({
        channel: IPC_CHANNELS.session.message.send,
      }),
    }));
    expect(api.run.events.list).toHaveBeenCalledWith(expect.objectContaining({
      meta: expect.objectContaining({
        channel: IPC_CHANNELS.run.events.list,
      }),
      payload: {
        runId: 'run-1',
      },
    }));
  });
});
