import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import { registerAgentMemoryHandlers } from '@megumi/desktop/main/ipc/handlers/agent-memory.handler';
import { runtimeOperationNameFromChannel } from '@megumi/desktop/main/ipc/runtime-operation-name';

describe('registerAgentMemoryHandlers', () => {
  it('registers memory handlers through runtime ipc envelope', async () => {
    const handle = vi.fn();
    const ipcMain = { handle };
    const service = {
      getSettings: vi.fn(() => ({
        workspaceId: 'workspace:1',
        autoCaptureEnabled: true,
        defaultCandidateReviewMode: 'manual',
        updatedAt: '2026-05-16T00:00:00.000Z',
      })),
    };

    registerAgentMemoryHandlers({ ipcMain, agentMemoryService: service as any });

    expect(handle).toHaveBeenCalledWith(
      IPC_CHANNELS.agent.memory.settingsGet,
      expect.any(Function),
    );
  });

  it('passes candidate edit fields through edit-and-accept handler', async () => {
    const handlers = new Map<string, (...args: any[]) => Promise<unknown>>();
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (...args: any[]) => Promise<unknown>) => {
        handlers.set(channel, handler);
      }),
    };
    const candidate = {
      candidateId: 'memory-candidate:1',
      workspaceId: 'workspace:1',
      scope: 'workspace',
      kind: 'constraint',
      content: 'edited candidate content',
      summary: 'edited summary',
      sourceRefs: [],
      confidence: 0.8,
      riskLevel: 'low',
      status: 'accepted',
      proposedBy: 'agent',
      createdAt: '2026-05-16T00:00:00.000Z',
      updatedAt: '2026-05-16T00:00:00.000Z',
      reviewedAt: '2026-05-16T00:00:00.000Z',
    };
    const memory = {
      memoryId: 'memory:1',
      workspaceId: 'workspace:1',
      scope: 'workspace',
      kind: 'constraint',
      content: 'edited candidate content',
      summary: 'edited summary',
      sourceRefs: [],
      confidence: 0.8,
      status: 'active',
      createdFromCandidateId: 'memory-candidate:1',
      createdAt: '2026-05-16T00:00:00.000Z',
      updatedAt: '2026-05-16T00:00:00.000Z',
    };
    const service = {
      acceptCandidate: vi.fn(() => ({ candidate, memory })),
    };

    registerAgentMemoryHandlers({ ipcMain: ipcMain as any, agentMemoryService: service as any });
    const handler = handlers.get(IPC_CHANNELS.agent.memory.candidateEditAndAccept);

    const result = await handler?.({} as any, {
      requestId: 'request:memory:edit',
      payload: {
        candidateId: 'memory-candidate:1',
        content: 'edited candidate content',
        summary: 'edited summary',
        kind: 'constraint',
        reviewedAt: '2026-05-16T00:00:00.000Z',
      },
      meta: {
        channel: IPC_CHANNELS.agent.memory.candidateEditAndAccept,
        createdAt: '2026-05-16T00:00:00.000Z',
        source: 'renderer',
      },
    });

    expect(service.acceptCandidate).toHaveBeenCalledWith(expect.objectContaining({
      candidateId: 'memory-candidate:1',
      content: 'edited candidate content',
      summary: 'edited summary',
      kind: 'constraint',
    }));
    expect(result).toMatchObject({
      ok: true,
      data: {
        memory: {
          content: 'edited candidate content',
        },
      },
    });
  });
});

describe('memory runtime operation names', () => {
  it('uses lowercase dotted/kebab operation names', () => {
    expect(runtimeOperationNameFromChannel(IPC_CHANNELS.agent.memory.settingsGet)).toBe(
      'agent.memory.settings.get',
    );
    expect(runtimeOperationNameFromChannel(IPC_CHANNELS.agent.memory.recallPreview)).toBe(
      'agent.memory.recall-preview',
    );
  });
});
