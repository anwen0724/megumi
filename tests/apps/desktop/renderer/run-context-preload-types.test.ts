// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import { createRendererRuntimeIpcRequest } from '@megumi/desktop/renderer/shared/ipc/runtime-request';
import type { MegumiAPI } from '@megumi/desktop/preload/types';

describe('run context preload API shape', () => {
  it('supports typed primary run context methods', async () => {
    const api: Pick<MegumiAPI, 'runContext'> = {
      runContext: {
        baselineGet: vi.fn(),
        sourcesList: vi.fn(),
      },
    };

    const primaryRequest = createRendererRuntimeIpcRequest(IPC_CHANNELS.runContext.baselineGet, {
      runId: 'run-1',
    });

    await api.runContext.baselineGet(primaryRequest);

    expect(api.runContext.baselineGet).toHaveBeenCalledWith(expect.objectContaining({
      meta: expect.objectContaining({
        channel: IPC_CHANNELS.runContext.baselineGet,
      }),
      payload: {
        runId: 'run-1',
      },
    }));
  });
});
