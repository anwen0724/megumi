// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/shared/ipc';
import type { RuntimeIpcRequest } from '@megumi/shared/ipc';
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
      memory: {
        settingsGet: vi.fn(async (request) => {
          expect(expectRuntimeRequest(request, IPC_CHANNELS.memory.settingsGet)).toEqual({
            workspaceId: 'workspace:1',
          });
          return {
            ok: true,
            data: { settings: { workspaceId: 'workspace:1', autoCaptureEnabled: true, defaultCandidateReviewMode: 'manual', updatedAt: now } },
            meta: { requestId: 'request:1', channel: IPC_CHANNELS.memory.settingsGet, handledAt: now },
          };
        }),
        candidateList: vi.fn(async (request) => {
          expect(expectRuntimeRequest(request, IPC_CHANNELS.memory.candidateList)).toMatchObject({
            workspaceId: 'workspace:1',
            status: 'proposed',
          });
          return {
            ok: true,
            data: { candidates: [] },
            meta: { requestId: 'request:2', channel: IPC_CHANNELS.memory.candidateList, handledAt: now },
          };
        }),
        memoryList: vi.fn(async (request) => {
          expect(expectRuntimeRequest(request, IPC_CHANNELS.memory.memoryList)).toMatchObject({
            workspaceId: 'workspace:1',
            status: 'active',
          });
          return {
            ok: true,
            data: { memories: [] },
            meta: { requestId: 'request:3', channel: IPC_CHANNELS.memory.memoryList, handledAt: now },
          };
        }),
        recallPreview: vi.fn(async (request) => {
          expect(expectRuntimeRequest(request, IPC_CHANNELS.memory.recallPreview)).toMatchObject({
            sessionId: 'session:1',
            projectId: 'project:1',
            scopes: ['project'],
            limit: 3,
            createdAt: now,
          });
          return {
            ok: true,
            data: {
              request: {
                recallRequestId: 'memory-recall:1',
                runId: 'run:1',
                sessionId: 'session:1',
                projectId: 'project:1',
                queryText: 'memory preview',
                requestedScopes: ['project'],
                maxResults: 3,
                createdAt: now,
                metadata: {},
              },
              results: [],
            },
            meta: { requestId: 'request:4', channel: IPC_CHANNELS.memory.recallPreview, handledAt: now },
          };
        }),
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
      projectId: 'project:1',
      scopes: ['project'],
      limit: 3,
      createdAt: now,
    });

    expect(useMemoryStore.getState().settings?.workspaceId).toBe('workspace:1');
    expect(useMemoryStore.getState().candidates).toEqual([]);
    expect(useMemoryStore.getState().memories).toEqual([]);
    expect(useMemoryStore.getState().recallPreview?.results).toEqual([]);
    expect(useMemoryStore.getState().error).toBeUndefined();
    expect(window.megumi.memory.settingsGet).toHaveBeenCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ channel: IPC_CHANNELS.memory.settingsGet }) }),
    );
    expect(window.megumi.memory.candidateList).toHaveBeenCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ channel: IPC_CHANNELS.memory.candidateList }) }),
    );
    expect(window.megumi.memory.memoryList).toHaveBeenCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ channel: IPC_CHANNELS.memory.memoryList }) }),
    );
    expect(window.megumi.memory.recallPreview).toHaveBeenCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ channel: IPC_CHANNELS.memory.recallPreview }) }),
    );
  });
});

