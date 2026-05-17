// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import { createRendererRuntimeIpcRequest } from '@megumi/desktop/renderer/shared/ipc/runtime-request';
import type { MegumiAPI } from '@megumi/desktop/preload/types';

describe('run mode preload API shape', () => {
  it('supports primary plan status methods', async () => {
    const api: Pick<MegumiAPI, 'plan'> = {
      plan: {
        byRunGet: vi.fn(),
        statusUpdate: vi.fn(),
      },
    };

    await api.plan.byRunGet(createRendererRuntimeIpcRequest(IPC_CHANNELS.plan.byRunGet, {
      runId: 'run:1',
    }));

    await api.plan.statusUpdate(createRendererRuntimeIpcRequest(
      IPC_CHANNELS.plan.statusUpdate,
      {
        planArtifactId: 'plan:1',
        status: 'accepted',
        updatedAt: '2026-05-15T00:00:01.000Z',
      },
    ));

    expect(api.plan.statusUpdate).toHaveBeenCalledWith(expect.objectContaining({
      meta: expect.objectContaining({
        channel: IPC_CHANNELS.plan.statusUpdate,
      }),
    }));
  });
});
