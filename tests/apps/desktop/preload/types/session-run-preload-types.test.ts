// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
          list: vi.fn(),
          send: vi.fn(),
          cancel: vi.fn(),
        },
        timeline: {
          list: vi.fn(),
        },
      },
      run: {
        listBySession: vi.fn(),
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
    const messagesRequest = createRendererRuntimeIpcRequest(IPC_CHANNELS.session.message.list, {
      sessionId: 'session-1',
    });
    const runsRequest = createRendererRuntimeIpcRequest(IPC_CHANNELS.run.listBySession, {
      sessionId: 'session-1',
    });

    await api.session.create(createRequest);
    await api.session.message.list(messagesRequest);
    await api.session.message.send(sendRequest);
    await api.run.listBySession(runsRequest);
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
    expect(api.session.message.list).toHaveBeenCalledWith(expect.objectContaining({
      meta: expect.objectContaining({
        channel: IPC_CHANNELS.session.message.list,
      }),
      payload: {
        sessionId: 'session-1',
      },
    }));
    expect(api.run.listBySession).toHaveBeenCalledWith(expect.objectContaining({
      meta: expect.objectContaining({
        channel: IPC_CHANNELS.run.listBySession,
      }),
      payload: {
        sessionId: 'session-1',
      },
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

  it('keeps session send preload types anchored to shared ipc schemas', () => {
    const source = readFileSync(join(process.cwd(), 'apps/desktop/src/preload/types.ts'), 'utf8');

    expect(source).toContain("from '@megumi/shared/ipc-schemas'");
    expect(source).toContain('SessionMessageSendData');
    expect(source).toContain('SessionMessageSendPayload');
  });
});
