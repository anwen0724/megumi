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
          onEvent: vi.fn((callback: (event: RuntimeEvent) => void) => {
            runtimeEventCallback = callback;
            return vi.fn();
          }),
        },
        session: {
          timeline: {
            list: vi.fn().mockResolvedValue({
              ok: true,
              data: {
                messages: [{
                  messageId: 'message-user-1',
                  role: 'user',
                  projectId: 'project-1',
                  sessionId: 'session-1',
                  runId: 'run-1',
                  createdAt,
                  blocks: [{
                    blockId: 'user-text:message-user-1',
                    kind: 'user_text',
                    text: '你好',
                    format: 'plain',
                  }],
                }, {
                  messageId: 'message-assistant-1',
                  role: 'assistant',
                  projectId: 'project-1',
                  sessionId: 'session-1',
                  runId: 'run-1',
                  createdAt,
                  workspaceChangeFooter: {
                    runId: 'run-1',
                    sessionId: 'session-1',
                    updatedAt: createdAt,
                    changeSets: [{
                      changeSetId: 'change-set-1',
                      changedFileCount: 1,
                      files: [{ changedFileId: 'file-1', workspacePath: 'README.md', changeKind: 'modified' }],
                    }],
                  },
                  blocks: [{
                    blockId: 'answer:message-assistant-1',
                    kind: 'answer_text',
                    runId: 'run-1',
                    textId: 'text:message-assistant-1',
                    status: 'completed',
                    text: '你好，我是 Megumi。',
                    format: 'markdown',
                    createdAt,
                  }],
                }],
                diagnostics: [],
              },
            }),
          },
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
              data: { status: 'cancelled' },
            }),
          },
          branchDraft: {
            create: vi.fn().mockResolvedValue({
              ok: true,
              data: {
                branchDraft: {
                  branchMarkerId: 'branch-marker-1',
                  sessionId: 'session-1',
                  sourceMessageId: 'message-assistant-1',
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
      }, { messageId: 'message-assistant-1' }));
      await Promise.resolve();
    });

    const session = useRuntimeTimelineStore.getState().sessions['project-1:session-1'];
    const assistant = session?.messages.find((message): message is TimelineAssistantMessage =>
      message.role === 'assistant' && message.runId === 'run-1',
    );
    const answer = assistant?.blocks.find((block) => block.kind === 'answer_text');
    const user = session?.messages.find((message) => message.role === 'user' && message.runId === 'run-1');

    expect(answer).toMatchObject({
      kind: 'answer_text',
      status: 'completed',
      text: '你好，我是 Megumi。',
    });
    expect(user?.messageId).toBe('message-user-1');
    expect(assistant?.messageId).toBe('message-assistant-1');
    expect(assistant?.workspaceChangeFooter).toMatchObject({
      changeSets: [{ files: [{ workspacePath: 'README.md' }] }],
    });
    expect(useChatUiStore.getState().sessionStates['session-1']).toMatchObject({
      agentStatus: 'idle',
      lastError: null,
    });
    expect(hydrateSessionTimeline).not.toHaveBeenCalled();
    expect(window.megumi.session.timeline.list).toHaveBeenCalledWith(expect.objectContaining({
      payload: {
        projectId: 'project-1',
        sessionId: 'session-1',
        runId: 'run-1',
      },
    }));
  });

  it('shows the product failure when a message cannot start a Run', async () => {
    vi.mocked(window.megumi.session.message.send).mockResolvedValueOnce({
      ok: true,
      data: {
        type: 'error',
        requestId: 'request-image-1',
        message: 'The selected image does not match its declared media type.',
      },
      meta: {
        requestId: 'request-image-1',
        channel: 'session:message:send',
        handledAt: createdAt,
        durationMs: 1,
      },
    });
    const { result } = renderHook(() => useSessionTimeline());
    let sent = true;

    await act(async () => {
      sent = await result.current.sendSessionMessage({
        message: 'Can you see this?',
        providerId: 'deepseek',
        model: 'deepseek-v4-flash',
        permissionMode: 'default',
      });
    });

    expect(sent).toBe(false);
    expect(useChatUiStore.getState().lastError).toBe('The selected image does not match its declared media type.');
    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({
        tone: 'error',
        title: 'Action failed',
        message: 'The selected image does not match its declared media type.',
      }),
    ]);
  });

  it('shows compaction progress and completion as one Session Timeline activity', async () => {
    let resolveSend!: (value: {
      ok: true;
      data: {
        type: 'completed';
        requestId: string;
        message: string;
        session: {
          id: string;
          projectId: string;
          title: string;
          status: 'active';
          createdAt: string;
          updatedAt: string;
        };
      };
      meta: {
        requestId: string;
        channel: 'session:message:send';
        handledAt: string;
        durationMs: number;
      };
    }) => void;
    const pendingSend = new Promise<Parameters<typeof resolveSend>[0]>((resolve) => {
      resolveSend = resolve;
    });
    vi.mocked(window.megumi.session.message.send).mockReturnValueOnce(pendingSend);
    const { result } = renderHook(() => useSessionTimeline());
    let sendPromise!: Promise<boolean>;

    act(() => {
      sendPromise = result.current.sendSessionMessage({
        message: '/compact',
        providerId: 'deepseek',
        model: 'deepseek-chat',
        permissionMode: 'default',
      });
    });

    expect(useRuntimeTimelineStore.getState().sessions['project-1:session-1']?.messages).toEqual([
      expect.objectContaining({
        role: 'activity',
        blocks: [expect.objectContaining({ status: 'running', label: '正在压缩上下文' })],
      }),
    ]);

    await act(async () => {
      resolveSend({
        ok: true,
        data: {
          type: 'completed',
          requestId: 'request-compact-1',
          message: 'Context compacted.',
          session: {
            id: 'session-1',
            projectId: 'project-1',
            title: 'Session',
            status: 'active',
            createdAt,
            updatedAt: createdAt,
          },
        },
        meta: {
          requestId: 'request-compact-1',
          channel: 'session:message:send',
          handledAt: createdAt,
          durationMs: 1,
        },
      });
      await sendPromise;
    });

    expect(useRuntimeTimelineStore.getState().sessions['project-1:session-1']?.messages).toEqual([
      expect.objectContaining({
        role: 'activity',
        blocks: [expect.objectContaining({ status: 'completed', label: '已完成压缩' })],
      }),
    ]);
    expect(useToastStore.getState().toasts).toEqual([]);
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
      data: {
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

  it('stores branch draft display copy without using the source message id as composer seed text', async () => {
    const { result } = renderHook(() => useSessionTimeline());

    await act(async () => {
      await result.current.createBranchDraft({
        messageId: 'message-assistant-1',
        label: 'Branching from this reply',
        preview: '我是 Megumi，一个 AI 编程助手！🤖',
      });
    });

    expect(window.megumi.session.branchDraft.create).toHaveBeenCalledWith(expect.objectContaining({
      payload: {
        sessionId: 'session-1',
        messageId: 'message-assistant-1',
      },
    }));
    expect(result.current.branchDraft).toMatchObject({
      branchMarkerId: 'branch-marker-1',
      label: 'Branching from this reply',
      preview: '我是 Megumi，一个 AI 编程助手！🤖',
    });
    expect(result.current.branchDraft).not.toHaveProperty('seedText');
  });

  it('sends the active branch marker with the next user message and keeps parent entries internal', async () => {
    const { result } = renderHook(() => useSessionTimeline());

    await act(async () => {
      await result.current.createBranchDraft({
        messageId: 'message-assistant-1',
        label: 'Branching from this reply',
        preview: 'assistant reply',
      });
    });
    await act(async () => {
      await result.current.sendSessionMessage({
        message: 'continue here',
        providerId: 'deepseek',
        model: 'deepseek-chat',
        permissionMode: 'default',
      });
    });

    expect(window.megumi.session.message.send).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        branchMarkerId: 'branch-marker-1',
      }),
    }));
    expect(window.megumi.session.message.send).not.toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        parentEntryId: expect.any(String),
      }),
    }));
  });
});
