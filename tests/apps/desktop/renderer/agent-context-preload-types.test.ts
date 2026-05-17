// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import { createRendererRuntimeIpcRequest } from '@megumi/desktop/renderer/shared/ipc/runtime-request';
import type { MegumiAPI } from '@megumi/desktop/preload/types';

describe('agent context preload API shape', () => {
  it('supports typed primary run context methods and deprecated agent aliases', async () => {
    const api: Pick<MegumiAPI, 'runContext' | 'agent'> = {
      runContext: {
        baselineGet: vi.fn(),
        sourcesList: vi.fn(),
      },
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

    const request = createRendererRuntimeIpcRequest(IPC_CHANNELS.agent.context.baselineGet, {
      runId: 'run-1',
    });
    const primaryRequest = createRendererRuntimeIpcRequest(IPC_CHANNELS.runContext.baselineGet, {
      runId: 'run-1',
    });

    await api.runContext.baselineGet(primaryRequest);
    await api.agent.context.baselineGet(request);

    expect(api.runContext.baselineGet).toHaveBeenCalledWith(expect.objectContaining({
      meta: expect.objectContaining({
        channel: IPC_CHANNELS.runContext.baselineGet,
      }),
      payload: {
        runId: 'run-1',
      },
    }));
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
