import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { RuntimeIpcRequest } from '@megumi/shared/ipc-contracts';
import { useMemoryStore } from '@megumi/desktop/renderer/entities/memory/store';

const now = '2026-05-16T00:00:00.000Z';

function expectRuntimeRequest<TPayload>(request: RuntimeIpcRequest<TPayload>, channel: string): TPayload {
  expect(request).toMatchObject({
    meta: {
      channel,
      source: 'renderer',
    },
  });
  expect(request).not.toHaveProperty('channel');
  return request.payload;
}

beforeEach(() => {
  useMemoryStore.setState(useMemoryStore.getInitialState(), true);
  (globalThis as any).window = {
    megumi: {
      agent: {
        memory: {
          settingsGet: vi.fn(async (request) => {
            expect(expectRuntimeRequest(request, IPC_CHANNELS.agent.memory.settingsGet)).toEqual({
              workspaceId: 'workspace:1',
            });
            return {
              ok: true,
              data: { settings: { workspaceId: 'workspace:1', autoCaptureEnabled: true, defaultCandidateReviewMode: 'manual', updatedAt: now } },
              meta: { requestId: 'request:1', channel: 'agent:memory:settings:get', handledAt: now },
            };
          }),
          candidateList: vi.fn(async (request) => {
            expect(expectRuntimeRequest(request, IPC_CHANNELS.agent.memory.candidateList)).toMatchObject({
              workspaceId: 'workspace:1',
              status: 'proposed',
            });
            return {
              ok: true,
              data: { candidates: [] },
              meta: { requestId: 'request:2', channel: 'agent:memory:candidate:list', handledAt: now },
            };
          }),
          memoryList: vi.fn(async (request) => {
            expect(expectRuntimeRequest(request, IPC_CHANNELS.agent.memory.memoryList)).toMatchObject({
              workspaceId: 'workspace:1',
              status: 'active',
            });
            return {
              ok: true,
              data: { memories: [] },
              meta: { requestId: 'request:3', channel: 'agent:memory:memory:list', handledAt: now },
            };
          }),
          recallPreview: vi.fn(async (request) => {
            expect(expectRuntimeRequest(request, IPC_CHANNELS.agent.memory.recallPreview)).toMatchObject({
              sessionId: 'session:1',
              workspaceId: 'workspace:1',
              scopes: ['workspace'],
              limit: 3,
              createdAt: now,
            });
            return {
              ok: true,
              data: {
                request: { recallRequestId: 'memory-recall:1', sessionId: 'session:1', scopes: ['workspace'], limit: 3, createdAt: now },
                results: [],
              },
              meta: { requestId: 'request:4', channel: 'agent:memory:recall-preview', handledAt: now },
            };
          }),
        },
      },
    },
  };
});

describe('useMemoryStore', () => {
  it('loads settings candidates memories and recall preview through preload API', async () => {
    await useMemoryStore.getState().loadSettings('workspace:1');
    await useMemoryStore.getState().loadCandidates({ workspaceId: 'workspace:1', status: 'proposed' });
    await useMemoryStore.getState().loadMemories({ workspaceId: 'workspace:1', status: 'active' });
    await useMemoryStore.getState().previewRecall({
      sessionId: 'session:1',
      workspaceId: 'workspace:1',
      scopes: ['workspace'],
      limit: 3,
      createdAt: now,
    });

    expect(useMemoryStore.getState().settings?.workspaceId).toBe('workspace:1');
    expect(useMemoryStore.getState().candidates).toEqual([]);
    expect(useMemoryStore.getState().memories).toEqual([]);
    expect(useMemoryStore.getState().recallPreview?.results).toEqual([]);
    expect(useMemoryStore.getState().error).toBeUndefined();
    expect(window.megumi.agent.memory.settingsGet).toHaveBeenCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ channel: IPC_CHANNELS.agent.memory.settingsGet }) }),
    );
    expect(window.megumi.agent.memory.candidateList).toHaveBeenCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ channel: IPC_CHANNELS.agent.memory.candidateList }) }),
    );
    expect(window.megumi.agent.memory.memoryList).toHaveBeenCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ channel: IPC_CHANNELS.agent.memory.memoryList }) }),
    );
    expect(window.megumi.agent.memory.recallPreview).toHaveBeenCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ channel: IPC_CHANNELS.agent.memory.recallPreview }) }),
    );
  });
});
