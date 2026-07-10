// @vitest-environment jsdom
/*
 * Verifies chat page controller UI feedback for failed actions.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useApprovalStore } from '@megumi/desktop/renderer/entities/approval';
import { useChatUiStore } from '@megumi/desktop/renderer/entities/chat-ui/store';
import { useProjectStore } from '@megumi/desktop/renderer/entities/project/store';
import { useRunStore } from '@megumi/desktop/renderer/entities/run/store';
import { useSessionStore } from '@megumi/desktop/renderer/entities/session/store';
import { useChatPageController } from '@megumi/desktop/renderer/features/chat/hooks/use-chat-page-controller';
import { useRuntimeTimelineStore } from '@megumi/desktop/renderer/features/runtime-timeline';
import { useToastStore } from '@megumi/desktop/renderer/shared/ui';

const createdAt = '2026-07-09T00:00:00.000Z';

describe('useChatPageController', () => {
  beforeEach(() => {
    useToastStore.getState().clearToasts();
    useApprovalStore.getState().reset();
    useRuntimeTimelineStore.getState().reset();
    useRunStore.getState().resetRuns();
    useChatUiStore.setState({
      activeSessionId: 'session-1',
      agentStatus: 'waiting-approval',
      lastError: null,
      sessionStates: {},
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
      sessions: [{
        id: 'session-1',
        projectId: 'project-1',
        title: 'Session',
        status: 'active',
        createdAt,
        updatedAt: createdAt,
      }],
      activeSessionId: 'session-1',
      newSessionDraftTargetProjectId: null,
    });

    Object.defineProperty(window, 'megumi', {
      configurable: true,
      value: {
        runtime: {
          onEvent: vi.fn(() => vi.fn()),
        },
        approval: {
          resolve: vi.fn().mockResolvedValue({
            ok: true,
            data: {
              status: 'failed',
              approvalRequestId: 'approval-1',
              failure: {
                code: 'runtime_interrupted',
                message: 'Approval continuation is no longer available in this runtime.',
              },
            },
          }),
        },
        session: {
          contextUsage: {
            get: vi.fn().mockResolvedValue({
              ok: true,
              data: { status: 'not_available', reason: 'not_calculated' },
            }),
          },
          message: {
            send: vi.fn(),
            cancel: vi.fn().mockResolvedValue({ ok: true, data: { cancelled: true, events: [] } }),
          },
          branchDraft: {
            create: vi.fn(),
            cancel: vi.fn(),
          },
        },
        workspace: {
          files: {
            open: vi.fn(),
          },
        },
      },
    });
  });

  it('shows a top toast when approval resume fails', async () => {
    const { result } = renderHook(() => useChatPageController());

    await act(async () => {
      await result.current.resolveApproval({
        approvalRequestId: 'approval-1',
        decision: 'approved',
        scope: 'once',
      });
    });

    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({
        tone: 'error',
        title: 'Approval failed',
        message: 'Approval continuation is no longer available in this runtime.',
      }),
    ]);
  });

  it('requests context usage with a background refresh for idle sessions', async () => {
    useChatUiStore.setState({
      ...useChatUiStore.getState(),
      agentStatus: 'idle',
    });

    renderHook(() => useChatPageController());

    await waitFor(() => {
      expect(window.megumi.session.contextUsage.get).toHaveBeenCalledWith(expect.objectContaining({
        payload: {
          sessionId: 'session-1',
          projectId: 'project-1',
          refresh: 'background',
        },
      }));
    });
  });
});
