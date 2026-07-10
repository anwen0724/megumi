// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectStore } from '@megumi/desktop/renderer/entities/project/store';
import { useSessionStore } from '@megumi/desktop/renderer/entities/session/store';
import { useAppBodyController } from '@megumi/desktop/renderer/shell/use-app-body-controller';
import { useSessionHistoryHydration } from '@megumi/desktop/renderer/features/session-history/use-session-history-hydration';

vi.mock('@megumi/desktop/renderer/features/session-history/use-session-history-hydration', () => ({
  useSessionHistoryHydration: vi.fn(),
}));

const createdAt = '2026-07-10T01:00:00.000Z';

describe('useAppBodyController', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'megumi', {
      configurable: true,
      value: {
        project: {
          list: vi.fn().mockResolvedValue({
            ok: true,
            data: { projects: [] },
          }),
        },
      },
    });
    useProjectStore.setState({
      projects: [{
        id: 'project-1',
        projectId: 'project-1',
        name: 'Project',
        repoPath: 'C:/repo',
        repoPathKey: 'repo-key',
        status: 'available',
        createdAt,
        lastOpenedAt: createdAt,
      }],
      currentProjectId: 'project-1',
      loading: false,
      error: null,
    });
    useSessionStore.setState({
      sessions: [
        {
          id: 'session-1',
          projectId: 'project-1',
          title: 'Current',
          status: 'active',
          createdAt,
          updatedAt: createdAt,
        },
        {
          id: 'session-2',
          projectId: 'project-1',
          title: 'Next',
          status: 'active',
          createdAt,
          updatedAt: createdAt,
        },
      ],
      activeSessionId: 'session-1',
    });
  });

  it('selects the session without waiting for timeline hydration to finish', async () => {
    let resolveHydration!: () => void;
    const hydrateSessionTimeline = vi.fn(() => new Promise<void>((resolve) => {
      resolveHydration = resolve;
    }));
    vi.mocked(useSessionHistoryHydration).mockReturnValue({
      hydrateSessions: vi.fn(),
      hydrateSessionTimeline,
    });
    const { result } = renderHook(() => useAppBodyController());

    let settled = false;
    await act(async () => {
      const selectionResult = result.current.handleSelectSession('session-2');
      void Promise.resolve(selectionResult).then(() => {
        settled = true;
      });
      await Promise.resolve();
    });

    expect(useSessionStore.getState().activeSessionId).toBe('session-2');
    expect(hydrateSessionTimeline).toHaveBeenCalledWith('session-2');
    expect(settled).toBe(true);

    resolveHydration();
  });
});
