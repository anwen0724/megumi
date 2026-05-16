// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import { RUN_MODE_PRESET_DEFAULTS } from '@megumi/shared/agent-run-mode-contracts';
import { createRendererRuntimeIpcRequest } from '@megumi/desktop/renderer/shared/ipc/runtime-request';
import type { MegumiAPI } from '@megumi/desktop/preload/types';

describe('agent run mode preload API shape', () => {
  it('supports mode snapshots on run start and plan status methods', async () => {
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

    await api.agent.run.start(createRendererRuntimeIpcRequest(IPC_CHANNELS.agent.run.start, {
      sessionId: 'session:1',
      goal: 'Write a plan',
      mode: 'plan',
      modeSnapshot: RUN_MODE_PRESET_DEFAULTS.plan,
      createdAt: '2026-05-15T00:00:00.000Z',
    }));

    await api.agent.plan.byRunGet(createRendererRuntimeIpcRequest(IPC_CHANNELS.agent.plan.byRunGet, {
      runId: 'run:1',
    }));

    await api.agent.plan.statusUpdate(createRendererRuntimeIpcRequest(
      IPC_CHANNELS.agent.plan.statusUpdate,
      {
        planArtifactId: 'plan:1',
        status: 'accepted',
        updatedAt: '2026-05-15T00:00:01.000Z',
      },
    ));

    expect(api.agent.plan.statusUpdate).toHaveBeenCalledWith(expect.objectContaining({
      meta: expect.objectContaining({
        channel: IPC_CHANNELS.agent.plan.statusUpdate,
      }),
    }));
  });
});
