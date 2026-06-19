import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../../../src/shared/renderer-contracts/ipc';
import { useChatStreamStore } from '../../../src/ui/features/chat-stream';
import { useProjectStore } from '../../../src/ui/entities/project/store';
import { useSessionStore } from '../../../src/ui/entities/session/store';
import { useAppBodyController } from '../../../src/ui/shell/use-app-body-controller';

function resetStores(): void {
  useChatStreamStore.getState().reset();
  useProjectStore.setState({
    projects: [{
      id: 'workspace-1',
      projectId: 'workspace-1',
      name: 'test',
      repoPath: 'C:/test',
      repoPathKey: 'c:/test',
      status: 'available',
      createdAt: '2026-06-20T00:00:00.000Z',
      lastOpenedAt: '2026-06-20T00:00:00.000Z',
    }],
    currentProjectId: 'workspace-1',
    loading: false,
    error: null,
  });
  useSessionStore.setState({
    sessions: [{
      id: 'session-1',
      projectId: 'workspace-1',
      agentType: 'free',
      title: 'Existing session',
      createdAt: '2026-06-20T00:00:00.000Z',
      updatedAt: '2026-06-20T00:00:00.000Z',
    }],
    activeSessionId: 'session-1',
    activeAgentType: 'free',
    newSessionDraftTargetProjectId: null,
  });
}

function installMegumiBridge() {
  const timelineList = vi.fn().mockResolvedValue({ ok: true, data: { sessionId: 'session-1', messages: [], runs: [], activePath: [], diagnostics: [] } });
  const runListBySession = vi.fn().mockResolvedValue({ ok: true, data: { runs: [] } });
  const runEventsList = vi.fn().mockResolvedValue({ ok: true, data: { events: [] } });

  window.megumi = {
    project: {
      list: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          projects: [{
            id: 'workspace-1',
            name: 'test',
            path: 'C:/test',
            status: 'available',
            createdAt: '2026-06-20T00:00:00.000Z',
            updatedAt: '2026-06-20T00:00:00.000Z',
            lastOpenedAt: '2026-06-20T00:00:00.000Z',
          }],
        },
      }),
      useExisting: vi.fn(),
      open: vi.fn(),
      remove: vi.fn(),
    },
    session: {
      list: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          sessions: [{
            sessionId: 'session-1',
            title: 'Existing session',
            workspaceId: 'workspace-1',
            status: 'active',
            createdAt: '2026-06-20T00:00:00.000Z',
            updatedAt: '2026-06-20T00:00:00.000Z',
          }],
        },
      }),
      timeline: { list: timelineList },
      message: { send: vi.fn(), cancel: vi.fn() },
      branchDraft: { create: vi.fn(), cancel: vi.fn() },
    },
    run: {
      listBySession: runListBySession,
      events: { list: runEventsList },
    },
  } as unknown as Window['megumi'];

  return { timelineList };
}

describe('src/ui app body session selection', () => {
  beforeEach(() => {
    resetStores();
  });

  it('rehydrates the timeline when selecting the already active session', async () => {
    const bridge = installMegumiBridge();
    const { result } = renderHook(() => useAppBodyController());

    await waitFor(() => expect(window.megumi.session.list).toHaveBeenCalled());
    bridge.timelineList.mockClear();

    await act(async () => {
      await result.current.handleSelectSession('session-1');
    });

    expect(bridge.timelineList).toHaveBeenCalledWith(expect.objectContaining({
      meta: expect.objectContaining({ channel: IPC_CHANNELS.session.timeline.list }),
      payload: { projectId: 'workspace-1', sessionId: 'session-1' },
    }));
  });
});
