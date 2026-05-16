// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import { createRendererRuntimeIpcRequest } from '@megumi/desktop/renderer/shared/ipc/runtime-request';
import type { MegumiAPI } from '@megumi/desktop/preload/types';

describe('agent lifecycle preload API shape', () => {
  it('supports typed agent session and run methods on window.megumi', async () => {
    const api: Pick<MegumiAPI, 'agent'> = {
      agent: {
        session: {
          create: vi.fn(),
          list: vi.fn(),
        },
        run: {
          start: vi.fn(),
        },
        context: {
          baselineGet: vi.fn(),
          sourcesList: vi.fn(),
        },
        plan: {
          byRunGet: vi.fn(),
          statusUpdate: vi.fn(),
        },
        tool: {
          definitionsList: vi.fn(),
          callGet: vi.fn(),
        },
        approval: {
          resolve: vi.fn(),
        },
        recovery: {
          listRecoverableRuns: vi.fn(),
          resume: vi.fn(),
          cancel: vi.fn(),
          retry: vi.fn(),
        },
        artifacts: {
          listByRun: vi.fn(),
          listBySession: vi.fn(),
          get: vi.fn(),
          getVersion: vi.fn(),
          createVersion: vi.fn(),
          updateStatus: vi.fn(),
          reference: vi.fn(),
        },
      },
    };

    const request = createRendererRuntimeIpcRequest(IPC_CHANNELS.agent.session.create, {
      title: 'Agent lifecycle',
      createdAt: '2026-05-15T00:00:00.000Z',
    });

    await api.agent.session.create(request);

    expect(api.agent.session.create).toHaveBeenCalledWith(expect.objectContaining({
      meta: expect.objectContaining({
        channel: IPC_CHANNELS.agent.session.create,
      }),
      payload: {
        title: 'Agent lifecycle',
        createdAt: '2026-05-15T00:00:00.000Z',
      },
    }));
  });
});
