// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import { createRendererRuntimeIpcRequest } from '@megumi/desktop/renderer/shared/ipc/runtime-request';
import type { MegumiAPI } from '@megumi/desktop/preload/types';

describe('agent artifact preload API shape', () => {
  it('supports primary artifact runtime ipc methods and deprecated agent aliases', async () => {
    const api: Pick<MegumiAPI, 'artifacts' | 'agent'> = {
      artifacts: {
        listByRun: vi.fn(),
        listBySession: vi.fn(),
        get: vi.fn(),
        getVersion: vi.fn(),
        createVersion: vi.fn(),
        updateStatus: vi.fn(),
        reference: vi.fn(),
      },
      agent: {
        session: { create: vi.fn(), list: vi.fn() },
        run: { start: vi.fn() },
        context: { baselineGet: vi.fn(), sourcesList: vi.fn() },
        plan: { byRunGet: vi.fn(), statusUpdate: vi.fn() },
        tool: { definitionsList: vi.fn(), callGet: vi.fn() },
        approval: { resolve: vi.fn() },
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
        memory: {
          settingsGet: vi.fn(),
          settingsUpdate: vi.fn(),
          candidateList: vi.fn(),
          candidateAccept: vi.fn(),
          candidateReject: vi.fn(),
          candidateArchive: vi.fn(),
          candidateEditAndAccept: vi.fn(),
          memoryList: vi.fn(),
          memoryGet: vi.fn(),
          memoryUpdate: vi.fn(),
          memoryArchive: vi.fn(),
          memoryDelete: vi.fn(),
          memoryDisable: vi.fn(),
          memoryEnable: vi.fn(),
          memorySourceRefsList: vi.fn(),
          memoryAccessLogsList: vi.fn(),
          recallPreview: vi.fn(),
        },
      },
    };

    await api.agent.artifacts.get(createRendererRuntimeIpcRequest(IPC_CHANNELS.agent.artifacts.get, {
      artifactId: 'artifact:1',
    }));
    await api.artifacts.get(createRendererRuntimeIpcRequest(IPC_CHANNELS.artifacts.get, {
      artifactId: 'artifact:1',
    }));

    await api.agent.artifacts.reference(createRendererRuntimeIpcRequest(IPC_CHANNELS.agent.artifacts.reference, {
      artifactId: 'artifact:1',
      referencedByKind: 'run',
      referencedById: 'run:next',
      createdAt: '2026-05-16T00:00:00.000Z',
    }));

    expect(api.agent.artifacts.get).toHaveBeenCalledWith(expect.objectContaining({
      meta: expect.objectContaining({
        channel: IPC_CHANNELS.agent.artifacts.get,
      }),
    }));
    expect(api.artifacts.get).toHaveBeenCalledWith(expect.objectContaining({
      meta: expect.objectContaining({
        channel: IPC_CHANNELS.artifacts.get,
      }),
    }));
  });
});
