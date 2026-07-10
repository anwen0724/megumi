// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeEvent } from '@megumi/coding-agent/events';
import type { TimelineAssistantMessage } from '@megumi/coding-agent/projections/timeline';
import { useChatUiStore } from '@megumi/desktop/renderer/entities/chat-ui/store';
import { useProjectStore } from '@megumi/desktop/renderer/entities/project/store';
import { useRunStore } from '@megumi/desktop/renderer/entities/run/store';
import { useSessionStore } from '@megumi/desktop/renderer/entities/session/store';
import { useSessionTimeline } from '@megumi/desktop/renderer/features/chat/hooks/use-session-timeline';
import { useRuntimeTimelineStore } from '@megumi/desktop/renderer/features/runtime-timeline';
import { useToastStore } from '@megumi/desktop/renderer/shared/ui';
import { useSessionHistoryHydration } from '@megumi/desktop/renderer/features/session-history/use-session-history-hydration';

vi.mock('@megumi/desktop/renderer/features/session-history/use-session-history-hydration', () => ({
  useSessionHistoryHydration: vi.fn(),
}));

const createdAt = '2026-05-17T00:00:00.000Z';

function runtimeEvent(
  eventType: RuntimeEvent['eventType'],
  sequence: number,
  payload: RuntimeEvent['payload'] = {},
  overrides: Partial<RuntimeEvent> = {},
): RuntimeEvent {
  return {
    eventId: `event-${sequence}`,
    schemaVersion: 1,
    eventType,
    runId: 'run-1',
    sessionId: 'session-1',
    sequence,
    createdAt: `2026-05-17T00:00:${sequence.toString().padStart(2, '0')}.000Z`,
    source: 'core',
    visibility: 'user',
    persist: 'required',
    payload,
    ...overrides,
  } as RuntimeEvent;
}

describe('useSessionTimeline', () => {
  let runtimeEventCallback: ((event: RuntimeEvent) => void) | undefined;
  let hydrateSessionTimeline: ReturnType<typeof vi.fn<(sessionId: string) => Promise<void>>>;

  beforeEach(() => {
    runtimeEventCallback = undefined;
    hydrateSessionTimeline = vi.fn<(sessionId: string) => Promise<void>>().mockResolvedValue(undefined);
    vi.mocked(useSessionHistoryHydration).mockReturnValue({
      hydrateSessions: vi.fn(),
      hydrateSessionTimeline,
    });
    useToastStore.getState().clearToasts();
    useRuntimeTimelineStore.getState().reset();
    useRunStore.getState().resetRuns();
    useChatUiStore.setState({
      activeSessionId: null,
      agentStatus: 'idle',
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
        agentType: 'free',
        title: 'Session',
        createdAt,
        updatedAt: createdAt,
      }],
      activeSessionId: 'session-1',
      activeAgentType: 'free',
      newSessionDraftTargetProjectId: null,
    });

    Object.defineProperty(window, 'megumi', {
      configurable: true,
      value: {
        runtime: {
          onEvent: vi.fn((callback: (event: RuntimeEvent) => void) => {
            runtimeEventCallback = callback;
            return vi.fn();
          }),
        },
        session: {
          message: {
            send: vi.fn().mockResolvedValue({
              ok: true,
              data: {
                type: 'agent_run',
                requestId: 'request-1',
                session: {
                  id: 'session-1',
                  projectId: 'project-1',
                  title: 'Session',
                  createdAt,
                  updatedAt: createdAt,
                },
                userMessageId: 'message-user-1',
                run: {
                  runId: 'run-1',
                  sessionId: 'session-1',
                  status: 'running',
                  createdAt,
                },
              },
            }),
            cancel: vi.fn().mockResolvedValue({
              ok: true,
              data: { cancelled: true },
            }),
          },
        },
      },
    });
  });

  it('consumes runtime events by run id after send returns the backend run id', async () => {
    const { result } = renderHook(() => useSessionTimeline());

    await act(async () => {
      await result.current.sendSessionMessage({
        message: '你好',
        providerId: 'deepseek',
        model: 'deepseek-chat',
        permissionMode: 'default',
      });
    });

    await act(async () => {
      runtimeEventCallback?.(runtimeEvent('model_call.text_delta', 2, {
        modelCallId: 'model-call-1',
        delta: '你好，',
      }));
      runtimeEventCallback?.(runtimeEvent('model_call.text_delta', 3, {
        modelCallId: 'model-call-1',
        delta: '我是 Megumi。',
      }));
      runtimeEventCallback?.(runtimeEvent('run.completed', 4, {
        assistantMessageId: 'message-assistant-1',
      }));
    });

    const session = useRuntimeTimelineStore.getState().sessions['project-1:session-1'];
    const assistant = session?.messages.find((message): message is TimelineAssistantMessage =>
      message.role === 'assistant' && message.runId === 'run-1',
    );
    const answer = assistant?.blocks.find((block) => block.kind === 'answer_text');

    expect(answer).toMatchObject({
      kind: 'answer_text',
      status: 'completed',
      text: '你好，我是 Megumi。',
    });
    expect(useChatUiStore.getState().sessionStates['session-1']).toMatchObject({
      agentStatus: 'idle',
      lastError: null,
    });
    expect(hydrateSessionTimeline).toHaveBeenCalledWith('session-1');
  });

  it('cancels a hydrated active run from the run store', async () => {
    useRunStore.setState({
      activeRunId: 'run-1',
      runs: {
        'run-1': {
          runId: 'run-1',
          sessionId: 'session-1',
          status: 'waiting_for_approval',
          updatedAt: createdAt,
        },
      },
    });
    const cancel = vi.mocked(window.megumi.session.message.cancel);
    const { result } = renderHook(() => useSessionTimeline());

    await act(async () => {
      await result.current.cancelSessionMessage();
    });

    expect(cancel).toHaveBeenCalledWith(expect.objectContaining({
      payload: { runId: 'run-1' },
    }));
    expect(useChatUiStore.getState().sessionStates['session-1']).toMatchObject({
      agentStatus: 'idle',
    });
  });

  it('shows a toast when cancel fails', async () => {
    useRunStore.setState({
      activeRunId: 'run-1',
      runs: {
        'run-1': {
          runId: 'run-1',
          sessionId: 'session-1',
          status: 'running',
          updatedAt: createdAt,
        },
      },
    });
    vi.mocked(window.megumi.session.message.cancel).mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'ipc_handler_failed',
        message: 'Cancel service failed.',
        severity: 'error',
        retryable: true,
        source: 'main',
      },
      meta: {
        requestId: 'request-cancel-1',
        channel: 'session:message:cancel',
        handledAt: createdAt,
        durationMs: 1,
      },
    });
    const { result } = renderHook(() => useSessionTimeline());

    await act(async () => {
      await result.current.cancelSessionMessage();
    });

    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({
        tone: 'error',
        title: 'Stop failed',
        message: 'Cancel service failed.',
      }),
    ]);
  });
});
