import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/shared/ipc';
import { registerMemoryHandlers } from '@megumi/desktop/main/ipc/handlers/memory.handler';
import { runtimeOperationNameFromChannel } from '@megumi/desktop/main/ipc/runtime-operation-name';

describe('registerMemoryHandlers', () => {
  it('registers primary memory IPC channels and deprecated agent bridges', async () => {
    const handle = vi.fn();
    const ipcMain = { handle };
    const service = {
      getSettings: vi.fn(() => ({
        autoCaptureEnabled: true,
        defaultCandidateReviewMode: 'manual',
        updatedAt: '2026-05-16T00:00:00.000Z',
      })),
    };

    registerMemoryHandlers({ ipcMain, memoryService: service as any });

    expect(handle).toHaveBeenCalledWith(
      IPC_CHANNELS.memory.settingsGet,
      expect.any(Function),
    );
    expect(service.getSettings).not.toHaveBeenCalled();
    expect(handle).toHaveBeenCalledWith(
      IPC_CHANNELS.memory.settingsUpdate,
      expect.any(Function),
    );
  });

  it('uses global memory settings IPC payloads without workspace settings fields', async () => {
    const handlers = new Map<string, (...args: any[]) => Promise<unknown>>();
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (...args: any[]) => Promise<unknown>) => {
        handlers.set(channel, handler);
      }),
    };
    const service = {
      getSettings: vi.fn(() => ({
        autoCaptureEnabled: true,
        defaultCandidateReviewMode: 'manual',
        updatedAt: '2026-05-16T00:00:00.000Z',
      })),
      updateSettings: vi.fn((settings) => settings),
    };

    registerMemoryHandlers({ ipcMain: ipcMain as any, memoryService: service as any });

    const getResult = await handlers.get(IPC_CHANNELS.memory.settingsGet)?.({} as any, {
      requestId: 'request:memory:settings:get',
      payload: {},
      meta: {
        channel: IPC_CHANNELS.memory.settingsGet,
        createdAt: '2026-05-16T00:00:00.000Z',
        source: 'renderer',
      },
    });
    expect(service.getSettings).toHaveBeenCalledWith();
    expect(JSON.stringify(getResult)).not.toContain('workspaceId');

    const updatePayload = {
      autoCaptureEnabled: false,
      defaultCandidateReviewMode: 'manual',
      updatedAt: '2026-05-16T00:01:00.000Z',
    } as const;
    const updateResult = await handlers.get(IPC_CHANNELS.memory.settingsUpdate)?.({} as any, {
      requestId: 'request:memory:settings:update',
      payload: updatePayload,
      meta: {
        channel: IPC_CHANNELS.memory.settingsUpdate,
        createdAt: '2026-05-16T00:00:00.000Z',
        source: 'renderer',
      },
    });

    expect(service.updateSettings).toHaveBeenCalledWith(updatePayload);
    expect(JSON.stringify(updateResult)).not.toContain('workspaceId');
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
      projectId: 'project:1',
      scope: 'project',
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
      projectId: 'project:1',
      scope: 'project',
      kind: 'constraint',
      status: 'active',
      content: 'edited candidate content',
      summary: 'edited summary',
      normalizedText: 'edited candidate content',
      dedupeKey: 'project:project:1:constraint:edited-candidate-content',
      source: 'manual_system',
      sourceRunId: null,
      sourceSessionId: null,
      sourceMessageId: null,
      sourceToolCallId: null,
      evidence: [],
      supersededById: null,
      createdAt: '2026-05-16T00:00:00.000Z',
      updatedAt: '2026-05-16T00:00:00.000Z',
      lastUsedAt: null,
      useCount: 0,
      deletedAt: null,
      metadata: {},
    };
    const service = {
      acceptCandidate: vi.fn(() => ({ candidate, memory })),
    };

    registerMemoryHandlers({ ipcMain: ipcMain as any, memoryService: service as any });
    const handler = handlers.get(IPC_CHANNELS.memory.candidateEditAndAccept);

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
        channel: IPC_CHANNELS.memory.candidateEditAndAccept,
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
    expect(runtimeOperationNameFromChannel(IPC_CHANNELS.memory.settingsGet)).toBe(
      'memory.settings.get',
    );
    expect(runtimeOperationNameFromChannel(IPC_CHANNELS.memory.recallPreview)).toBe(
      'memory.recall-preview',
    );
  });
});

