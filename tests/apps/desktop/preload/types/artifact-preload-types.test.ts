// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/desktop/main/ipc/channels';
import { createRendererRuntimeIpcRequest } from '@megumi/desktop/renderer/shared/ipc/runtime-request';
import type { MegumiAPI } from '@megumi/desktop/preload/types';

describe('artifact preload API shape', () => {
  it('supports primary artifact runtime ipc methods', async () => {
    const api: Pick<MegumiAPI, 'artifacts'> = {
      artifacts: {
        listByRun: vi.fn(),
        listBySession: vi.fn(),
        get: vi.fn(),
        getVersion: vi.fn(),
        createVersion: vi.fn(),
        updateStatus: vi.fn(),
        reference: vi.fn(),
      },
    };

    await api.artifacts.get(createRendererRuntimeIpcRequest(IPC_CHANNELS.artifacts.get, {
      artifactId: 'artifact:1',
    }));

    await api.artifacts.reference(createRendererRuntimeIpcRequest(IPC_CHANNELS.artifacts.reference, {
      artifactId: 'artifact:1',
      referencedByKind: 'run',
      referencedById: 'run:next',
    }));

    expect(api.artifacts.get).toHaveBeenCalledWith(expect.objectContaining({
      meta: expect.objectContaining({
        channel: IPC_CHANNELS.artifacts.get,
      }),
    }));
  });
});

