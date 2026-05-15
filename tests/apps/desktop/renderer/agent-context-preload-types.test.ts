// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import { createRendererRuntimeIpcRequest } from '@megumi/desktop/renderer/shared/ipc/runtime-request';
import type { MegumiAPI } from '@megumi/desktop/preload/types';

describe('agent context preload API shape', () => {
  it('supports typed context methods on window.megumi.agent.context', async () => {
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
      },
    };

    const request = createRendererRuntimeIpcRequest(IPC_CHANNELS.agent.context.baselineGet, {
      runId: 'run-1',
    });

    await api.agent.context.baselineGet(request);

    expect(api.agent.context.baselineGet).toHaveBeenCalledWith(expect.objectContaining({
      meta: expect.objectContaining({
        channel: IPC_CHANNELS.agent.context.baselineGet,
      }),
      payload: {
        runId: 'run-1',
      },
    }));
  });
});
