// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { ChatStreamEvent } from '@megumi/shared/chat-stream-events';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import type { TimelineAssistantMessage, TimelineUserMessage } from '@megumi/shared/timeline-message-blocks';
import { useSessionStore } from '@megumi/desktop/renderer/entities/session/store';
import { useArtifactStore } from '@megumi/desktop/renderer/entities/artifact';
import { useChatUiStore } from '@megumi/desktop/renderer/entities/chat-ui/store';
import { useProjectStore } from '@megumi/desktop/renderer/entities/project/store';
import { useRunStore } from '@megumi/desktop/renderer/entities/run/store';
import {
  chatStreamSessionKey,
  useChatStreamStore,
} from '@megumi/desktop/renderer/features/chat-stream';
import { useSessionTimeline } from '@megumi/desktop/renderer/features/chat/hooks/use-session-timeline';
import { useSessionHistoryHydration } from '@megumi/desktop/renderer/features/session-history/use-session-history-hydration';

let runtimeEventCallback: ((event: RuntimeEvent) => void) | null = null;
let chatStreamEventCallback: ((event: ChatStreamEvent) => void) | null = null;
let sequence = 1;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function emitRuntimeEvent(event: Omit<RuntimeEvent, 'eventId' | 'schemaVersion' | 'sequence' | 'createdAt' | 'source' | 'visibility' | 'persist'> & {
  source?: RuntimeEvent['source'];
  visibility?: RuntimeEvent['visibility'];
  persist?: RuntimeEvent['persist'];
}) {
  runtimeEventCallback?.({
    eventId: `event-${sequence}`,
    schemaVersion: 1,
    sequence: sequence++,
    createdAt: '2026-05-12T00:00:00.000Z',
    source: event.source ?? 'provider',
    visibility: event.visibility ?? 'user',
    persist: event.persist ?? 'required',
    ...event,
  } as RuntimeEvent);
}

function runtimeEvent(overrides: Partial<RuntimeEvent> & Pick<RuntimeEvent, 'eventType' | 'runId'>): RuntimeEvent {
  return {
    eventId: `runtime-event-${sequence}`,
    schemaVersion: 1,
    sequence: sequence++,
    createdAt: '2026-05-24T00:00:00.000Z',
    source: 'core',
    visibility: 'system',
    persist: 'required',
    payload: {},
    ...overrides,
  } as RuntimeEvent;
}

function chatEvent(overrides: Partial<ChatStreamEvent> & Pick<ChatStreamEvent, 'eventType' | 'runId' | 'streamId' | 'seq'>): ChatStreamEvent {
  return {
    eventId: `chat-stream-event-${overrides.seq}`,
    projectId: 'project-1',
    sessionId: 'session-1',
    streamKind: 'main',
    createdAt: '2026-05-24T00:00:00.000Z',
    ...overrides,
  } as ChatStreamEvent;
}

function installMegumiMock() {
  const unsubscribeChatStream = vi.fn(() => {
    chatStreamEventCallback = null;
  });
  const session = {
    message: {
      send: vi.fn().mockImplementation((request) => Promise.resolve({
        ok: true,
        data: {
          requestId: request.requestId,
        },
        meta: {
          requestId: request.requestId,
          channel: IPC_CHANNELS.session.message.send,
          traceId: request.context.traceId,
          operationName: request.context.operationName,
          handledAt: '2026-05-12T00:00:00.100Z',
        },
      })),
      cancel: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          cancelled: true,
        },
        meta: {
          requestId: 'ipc-session-message-cancel-1',
          channel: IPC_CHANNELS.session.message.cancel,
          handledAt: '2026-05-12T00:00:00.100Z',
        },
      }),
      list: vi.fn().mockResolvedValue({
        ok: true,
        data: { messages: [] },
      }),
    },
    timeline: {
      list: vi.fn().mockResolvedValue({
        ok: true,
        data: { messages: [], diagnostics: [] },
      }),
    },
  };
  const run = {
    listBySession: vi.fn().mockResolvedValue({
      ok: true,
      data: { runs: [] },
    }),
    events: {
      list: vi.fn().mockResolvedValue({
        ok: true,
        data: { events: [] },
      }),
    },
  };
  const runtime = {
    onEvent: vi.fn((callback: (event: RuntimeEvent) => void) => {
      runtimeEventCallback = callback;
      return () => {
        runtimeEventCallback = null;
      };
    }),
  };
  const chatStream = {
    onEvent: vi.fn((callback: (event: ChatStreamEvent) => void) => {
      chatStreamEventCallback = callback;
      return unsubscribeChatStream;
    }),
  };

  Object.defineProperty(window, 'megumi', {
    configurable: true,
    value: {
      session,
      provider: {
        list: vi.fn(),
        update: vi.fn(),
        setApiKey: vi.fn(),
        deleteApiKey: vi.fn(),
      },
      runtime,
      chatStream,
      run,
    },
  });

  return { session, runtime, chatStream, run, unsubscribeChatStream };
}

function committedAssistant(messageId: string, runId: string, text: string): TimelineAssistantMessage {
  return {
    messageId,
    role: 'assistant',
    projectId: 'project-1',
    sessionId: 'session-1',
    runId,
    turnOrder: 1,
    createdAt: '2026-05-24T00:00:00.000Z',
    updatedAt: '2026-05-24T00:00:00.000Z',
    blocks: [{
      blockId: `answer:${runId}`,
      kind: 'answer_text',
      runId,
      textId: `text:${runId}`,
      status: 'completed',
      text,
      format: 'markdown',
    }],
  };
}

function committedUser(messageId: string, text: string, runId = 'run-history'): TimelineUserMessage {
  return {
    messageId,
    role: 'user',
    projectId: 'project-1',
    sessionId: 'session-1',
    runId,
    turnOrder: 0,
    createdAt: '2026-05-24T00:00:00.000Z',
    updatedAt: '2026-05-24T00:00:00.000Z',
    blocks: [{
      blockId: `user-text:${messageId}`,
      kind: 'user_text',
      text,
      format: 'plain',
    }],
  };
}

describe('useSessionTimeline', () => {
  beforeEach(() => {
    runtimeEventCallback = null;
    chatStreamEventCallback = null;
    sequence = 1;
    useChatUiStore.setState({
      activeSessionId: null,
      agentStatus: 'idle',
      lastError: null,
      sessionStates: {},
    });
    useSessionStore.setState({
      sessions: [],
      activeSessionId: null,
      activeAgentType: 'free',
    });
    useProjectStore.setState({
      currentProjectId: 'project-1',
      projects: [{
        id: 'project-1',
        name: 'Megumi',
        repoPath: 'C:/all/work/study/megumi',
        createdAt: '2026-05-12T00:00:00.000Z',
        projectId: 'project-1',
        repoPathKey: 'c:/all/work/study/megumi',
        lastOpenedAt: '2026-05-19T00:00:00.000Z',
        status: 'available' as const,
      }],
    });
    useArtifactStore.getState().clearArtifacts();
    useRunStore.getState().resetRuns();
    useChatStreamStore.getState().reset();
  });

  it('clears active chat stream state when the current project no longer owns the active session', () => {
    installMegumiMock();
    useSessionStore.setState({
      sessions: [{
        id: 'session-project-1',
        projectId: 'project-1',
        agentType: 'free',
        title: 'Project 1 session',
        createdAt: '2026-05-12T00:00:00.000Z',
        updatedAt: '2026-05-12T00:00:00.000Z',
      }],
      activeSessionId: 'session-project-1',
      activeAgentType: 'free',
    });
    useProjectStore.setState({
      currentProjectId: 'project-1',
      projects: [
        {
          id: 'project-1',
          name: 'Megumi',
          repoPath: 'C:/all/work/study/megumi',
          createdAt: '2026-05-12T00:00:00.000Z',
          projectId: 'project-1',
          repoPathKey: 'c:/all/work/study/megumi',
          lastOpenedAt: '2026-05-19T00:00:00.000Z',
          status: 'available' as const,
        },
        {
          id: 'project-2',
          name: 'Other',
          repoPath: 'C:/all/work/study/other',
          createdAt: '2026-05-12T00:00:00.000Z',
          projectId: 'project-2',
          repoPathKey: 'c:/all/work/study/other',
          lastOpenedAt: '2026-05-19T00:00:00.000Z',
          status: 'available' as const,
        },
      ],
    });
    renderHook(() => useSessionTimeline());

    expect(useChatStreamStore.getState()).toMatchObject({
      activeProjectId: 'project-1',
      activeSessionId: 'session-project-1',
      activeSessionKey: chatStreamSessionKey('project-1', 'session-project-1'),
    });

    act(() => {
      useProjectStore.setState({ currentProjectId: 'project-2' });
    });

    expect(useChatStreamStore.getState()).toMatchObject({
      activeProjectId: null,
      activeSessionId: null,
      activeSessionKey: null,
    });
  });

  it('dispatches chat stream listener events into the stream store and unsubscribes on unmount', () => {
    const { unsubscribeChatStream } = installMegumiMock();
    const { unmount } = renderHook(() => useSessionTimeline());

    act(() => {
      chatStreamEventCallback?.({
        eventId: 'chat-stream-event-1',
        eventType: 'turn.started',
        projectId: 'project-1',
        sessionId: 'session-1',
        runId: 'run-1',
        streamId: 'stream-1',
        streamKind: 'main',
        seq: 1,
        createdAt: '2026-05-24T00:00:00.000Z',
        userMessageId: 'message-user-1',
      });
    });

    expect(useChatStreamStore.getState().sessions[chatStreamSessionKey('project-1', 'session-1')].messages).toEqual([
      expect.objectContaining({
        messageId: 'assistant:run-1',
        role: 'assistant',
      }),
    ]);

    unmount();

    expect(unsubscribeChatStream).toHaveBeenCalledTimes(1);
    expect(chatStreamEventCallback).toBeNull();
  });

  it('starts backend chat with an ipc request envelope, creates a session, and applies stream events', async () => {
    const { session } = installMegumiMock();
    useProjectStore.setState({
      currentProjectId: 'project-1',
      projects: [{
        id: 'project-1',
        name: 'Megumi',
        repoPath: 'C:/all/work/study/megumi',
        createdAt: '2026-05-12T00:00:00.000Z',
        projectId: 'project-1',
        repoPathKey: 'c:/all/work/study/megumi',
        lastOpenedAt: '2026-05-19T00:00:00.000Z',
        status: 'available' as const,
      }],
    });
    const { result } = renderHook(() => useSessionTimeline());

    await act(async () => {
      await result.current.sendSessionMessage({
        message: 'Hello Megumi',
        permissionMode: 'plan',
        model: 'deepseek-v4-flash',
      });
    });

    expect(session.message.send).toHaveBeenCalledWith(expect.objectContaining({
      requestId: expect.stringMatching(/^ipc-session-message-/),
      payload: expect.objectContaining({
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        context: expect.objectContaining({
          workspaceId: 'project-1',
          workspacePath: 'C:/all/work/study/megumi',
          permissionMode: 'plan',
          sessionTitle: 'Hello Megumi',
        }),
        message: expect.objectContaining({
          content: 'Hello Megumi',
        }),
      }),
      meta: expect.objectContaining({
        channel: IPC_CHANNELS.session.message.send,
        source: 'renderer',
      }),
      context: expect.objectContaining({
        requestId: expect.stringMatching(/^ipc-session-message-/),
        traceId: expect.stringMatching(/^trace-/),
        operationName: 'session.message.send',
        source: 'renderer',
      }),
    }));
    const requestId = session.message.send.mock.calls[0][0].requestId;
    const activeSessionId = useSessionStore.getState().activeSessionId;
    expect(useChatStreamStore.getState()).toMatchObject({
      activeProjectId: 'project-1',
      activeSessionId,
      activeSessionKey: activeSessionId ? chatStreamSessionKey('project-1', activeSessionId) : null,
    });
    expect(useSessionStore.getState().sessions[0].title).toBe('Hello Megumi');
    expect(useChatStreamStore.getState().sessions[chatStreamSessionKey('project-1', activeSessionId ?? '')].messages[0]).toMatchObject({
      role: 'user',
      blocks: [expect.objectContaining({
        kind: 'user_text',
        text: 'Hello Megumi',
      })],
    });
    expect(useChatUiStore.getState().agentStatus).toBe('sending');

    act(() => {
      emitRuntimeEvent({
        eventType: 'run.started',
        requestId,
        runId: 'run-1',
        source: 'core',
        visibility: 'system',
        payload: {
          providerId: 'deepseek',
          modelId: 'deepseek-v4-flash',
          runKind: 'chat',
        },
      });
      emitRuntimeEvent({
        eventType: 'assistant.output.delta',
        requestId,
        runId: 'run-1',
        persist: 'transient',
        payload: {
          delta: 'Hi there',
        },
      });
    });

    expect(useChatUiStore.getState().agentStatus).toBe('running');

    act(() => {
      emitRuntimeEvent({
        eventType: 'model.step.completed',
        requestId,
        runId: 'run-1',
        source: 'provider',
        visibility: 'system',
        payload: {
          modelStepId: 'model-step-1',
          finishReason: 'stop',
        },
      });
      emitRuntimeEvent({
        eventType: 'assistant.output.completed',
        requestId,
        runId: 'run-1',
        visibility: 'system',
        payload: {
          content: 'Hi there',
        },
      });
      emitRuntimeEvent({
        eventType: 'run.completed',
        requestId,
        runId: 'run-1',
        source: 'core',
        visibility: 'system',
        payload: {},
      });
    });

    expect(useChatUiStore.getState().agentStatus).toBe('idle');
  });

  it('does not synthesize artifact state from completed runtime chat output', async () => {
    const { session } = installMegumiMock();
    const { result } = renderHook(() => useSessionTimeline());

    await act(async () => {
      await result.current.sendSessionMessage({
        message: 'Summarize runtime chat',
        permissionMode: 'auto',
        model: 'deepseek-v4-pro',
      });
    });

    const requestId = session.message.send.mock.calls[0][0].requestId;

    act(() => {
      emitRuntimeEvent({
        eventType: 'assistant.output.completed',
        requestId,
        runId: 'run-bridge',
        visibility: 'system',
        payload: {
          content: 'Runtime response summary.',
        },
      });
      emitRuntimeEvent({
        eventType: 'run.completed',
        requestId,
        runId: 'run-bridge',
        source: 'core',
        visibility: 'system',
        payload: {},
      });
    });

    expect(useArtifactStore.getState().artifacts).toEqual([]);
  });

  it('turns session message send failure envelopes into status errors without legacy assistant messages', async () => {
    const { session } = installMegumiMock();
    session.message.send.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'provider_missing_api_key',
        message: 'Provider API key is missing.',
        severity: 'error',
        retryable: false,
        source: 'provider',
        debugId: 'debug-chat-start-1',
      },
      meta: {
        requestId: 'ipc-session-message-send-1',
        channel: IPC_CHANNELS.session.message.send,
        traceId: 'trace-chat-start-1',
        debugId: 'debug-chat-start-1',
        operationName: 'session.message.send',
        handledAt: '2026-05-12T00:00:00.100Z',
      },
    });
    const { result } = renderHook(() => useSessionTimeline());

    await act(async () => {
      await result.current.sendSessionMessage({
        message: 'Use OpenAI',
        permissionMode: 'default',
        model: 'gpt-4.1',
      });
    });

    expect(useChatUiStore.getState()).toMatchObject({
      agentStatus: 'error',
      lastError: 'Provider API key is missing.',
    });
    const activeSessionId = useSessionStore.getState().activeSessionId;
    expect(useChatStreamStore.getState().sessions[chatStreamSessionKey('project-1', activeSessionId ?? '')].messages).toEqual([
      expect.objectContaining({
        role: 'user',
        blocks: [expect.objectContaining({ kind: 'user_text', text: 'Use OpenAI' })],
      }),
    ]);
  });

  it('does not commit completed runtime output through legacy flat assistant messages', async () => {
    const { session } = installMegumiMock();
    const { result } = renderHook(() => useSessionTimeline());

    await act(async () => {
      await result.current.sendSessionMessage({
        message: 'Return final only',
        permissionMode: 'default',
        model: 'deepseek-v4-flash',
      });
    });

    const requestId = session.message.send.mock.calls[0][0].requestId;

    act(() => {
      emitRuntimeEvent({
        eventType: 'run.started',
        requestId,
        runId: 'run-1',
        source: 'core',
        visibility: 'system',
        payload: {
          providerId: 'deepseek',
          modelId: 'deepseek-v4-flash',
          runKind: 'chat',
        },
      });
      emitRuntimeEvent({
        eventType: 'assistant.output.completed',
        requestId,
        runId: 'run-1',
        visibility: 'system',
        payload: {
          content: 'Complete response without deltas',
        },
      });
      emitRuntimeEvent({
        eventType: 'run.completed',
        requestId,
        runId: 'run-1',
        source: 'core',
        visibility: 'system',
        payload: {},
      });
    });

    expect(useChatUiStore.getState().agentStatus).toBe('idle');
    expect(JSON.stringify(useChatStreamStore.getState().sessions)).not.toContain('Complete response without deltas');
  });

  it('projects failed runtime stream events to UI error state only', async () => {
    const { session } = installMegumiMock();
    const { result } = renderHook(() => useSessionTimeline());

    await act(async () => {
      await result.current.sendSessionMessage({
        message: 'Use unsupported provider',
        permissionMode: 'default',
        model: 'claude-opus-4-7',
      });
    });

    act(() => {
      const requestId = session.message.send.mock.calls[0][0].requestId;
      emitRuntimeEvent({
        eventType: 'run.failed',
        requestId,
        runId: 'run-1',
        source: 'provider',
        payload: {
          error: {
            code: 'provider_disabled',
          message: 'Provider is disabled.',
            severity: 'error',
          retryable: false,
            source: 'provider',
          },
        },
      });
    });

    const activeSessionId = useSessionStore.getState().activeSessionId;
    expect(useChatStreamStore.getState().sessions[chatStreamSessionKey('project-1', activeSessionId ?? '')].messages).toEqual([
      expect.objectContaining({
        role: 'user',
        blocks: [expect.objectContaining({ kind: 'user_text', text: 'Use unsupported provider' })],
      }),
    ]);
    expect(useChatUiStore.getState()).toMatchObject({
      agentStatus: 'error',
      lastError: 'Provider is disabled.',
    });
  });

  it('retries the failed message with the current model override', async () => {
    const { session } = installMegumiMock();
    const { result } = renderHook(() => useSessionTimeline());

    await act(async () => {
      await result.current.sendSessionMessage({
        message: 'Try Claude first',
        permissionMode: 'default',
        model: 'claude-opus-4-7',
      });
    });

    await act(async () => {
      await result.current.retryLastSessionMessage({
        permissionMode: 'default',
        model: 'deepseek-v4-flash',
      });
    });

    expect(session.message.send).toHaveBeenCalledTimes(2);
    expect(session.message.send.mock.calls[1][0]).toMatchObject({
      payload: expect.objectContaining({
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        message: expect.objectContaining({
          content: 'Try Claude first',
        }),
      }),
    });
  });

  it('sends only the current user message and leaves model context construction to main', async () => {
    const { session } = installMegumiMock();
    useSessionStore.setState({
      sessions: [{
        id: 'session-1',
        projectId: 'project-1',
        agentType: 'free',
        title: 'Canonical session',
        createdAt: '2026-05-24T00:00:00.000Z',
        updatedAt: '2026-05-24T00:00:00.000Z',
      }],
      activeSessionId: 'session-1',
      activeAgentType: 'free',
    });
    useChatStreamStore.getState().hydrateCommittedMessages('project-1', 'session-1', [
      committedUser('message-user-history', 'Canonical user prompt', 'run-history'),
      committedAssistant('assistant:run-history', 'run-history', 'Canonical answer'),
    ]);
    const { result } = renderHook(() => useSessionTimeline());

    await act(async () => {
      await result.current.sendSessionMessage({
        message: 'Next prompt',
        permissionMode: 'plan',
        model: 'deepseek-v4-flash',
      });
    });

    const payload = session.message.send.mock.calls[0][0].payload;

    expect(payload).not.toHaveProperty('messages');
    expect(payload.message).toMatchObject({
      content: 'Next prompt',
      createdAt: expect.any(String),
    });
  });

  it('does not send canonical history from renderer when committed timeline contains prior turns', async () => {
    const { session } = installMegumiMock();
    useSessionStore.setState({
      sessions: [{
        id: 'session-1',
        projectId: 'project-1',
        agentType: 'free',
        title: 'Canonical context session',
        createdAt: '2026-05-24T00:00:00.000Z',
        updatedAt: '2026-05-24T00:00:00.000Z',
      }],
      activeSessionId: 'session-1',
      activeAgentType: 'free',
    });
    useChatStreamStore.getState().hydrateCommittedMessages('project-1', 'session-1', [
      committedUser('message-user-history', 'Canonical user prompt', 'run-completed'),
      committedAssistant('assistant:run-completed', 'run-completed', 'Completed answer'),
      {
        ...committedAssistant('assistant:run-failed', 'run-failed', 'Partial answer'),
        blocks: [{
          blockId: 'answer:run-failed',
          kind: 'answer_text',
          runId: 'run-failed',
          textId: 'text-failed',
          status: 'failed',
          text: 'Partial answer',
          format: 'markdown',
        }],
      },
    ]);
    const { result } = renderHook(() => useSessionTimeline());

    await act(async () => {
      await result.current.sendSessionMessage({
        message: 'Next prompt',
        permissionMode: 'plan',
        model: 'deepseek-v4-flash',
      });
    });

    const payload = session.message.send.mock.calls[0][0].payload;

    expect(payload).not.toHaveProperty('messages');
    expect(payload.message).toMatchObject({
      content: 'Next prompt',
    });
  });

  it('keeps each renderer send scoped to the current user message', async () => {
    const { session } = installMegumiMock();
    useSessionStore.setState({
      sessions: [{
        id: 'session-1',
        projectId: 'project-1',
        agentType: 'free',
        title: 'No duplicate users',
        createdAt: '2026-05-24T00:00:00.000Z',
        updatedAt: '2026-05-24T00:00:00.000Z',
      }],
      activeSessionId: 'session-1',
      activeAgentType: 'free',
    });
    const { result } = renderHook(() => useSessionTimeline());

    await act(async () => {
      await result.current.sendSessionMessage({
        message: 'First prompt',
        permissionMode: 'default',
        model: 'deepseek-v4-flash',
      });
    });

    const firstPayload = session.message.send.mock.calls[0][0].payload;
    const clientMessageId = firstPayload.message?.id;
    expect(clientMessageId).toEqual(expect.any(String));

    useChatStreamStore.getState().dispatch(chatEvent({
      eventType: 'turn.started',
      seq: 1,
      projectId: 'project-1',
      sessionId: 'session-1',
      runId: 'run-1',
      streamId: 'stream-1',
      userMessageId: 'message-user-1',
    }));
    useChatStreamStore.getState().dispatch(chatEvent({
      eventType: 'user.message.committed',
      seq: 2,
      projectId: 'project-1',
      sessionId: 'session-1',
      runId: 'run-1',
      streamId: 'stream-1',
      messageId: 'message-user-1',
      clientMessageId,
      text: 'First prompt',
    }));
    useChatStreamStore.getState().flushStream('project-1', 'session-1', 'stream-1');

    await act(async () => {
      await result.current.sendSessionMessage({
        message: 'Second prompt',
        permissionMode: 'default',
        model: 'deepseek-v4-flash',
      });
    });

    const secondPayload = session.message.send.mock.calls[1][0].payload;
    expect(secondPayload).not.toHaveProperty('messages');
    expect(secondPayload.message).toMatchObject({ content: 'Second prompt' });
  });

  it('does not use legacy user context when canonical timeline only has assistant history', async () => {
    const { session } = installMegumiMock();
    useSessionStore.setState({
      sessions: [{
        id: 'session-1',
        projectId: 'project-1',
        agentType: 'free',
        title: 'Partial canonical session',
        createdAt: '2026-05-24T00:00:00.000Z',
        updatedAt: '2026-05-24T00:00:00.000Z',
      }],
      activeSessionId: 'session-1',
      activeAgentType: 'free',
    });
    useChatStreamStore.getState().hydrateCommittedMessages('project-1', 'session-1', [
      committedAssistant('assistant:run-history', 'run-history', 'Canonical answer'),
    ]);
    const { result } = renderHook(() => useSessionTimeline());

    await act(async () => {
      await result.current.sendSessionMessage({
        message: 'Next prompt',
        permissionMode: 'plan',
        model: 'deepseek-v4-flash',
      });
    });

    const payload = session.message.send.mock.calls[0][0].payload;

    expect(payload).not.toHaveProperty('messages');
    expect(payload.message).toMatchObject({
      content: 'Next prompt',
    });
  });

  it('cancels session messages using a runtime ipc cancel request envelope', async () => {
    const { session } = installMegumiMock();
    const { result } = renderHook(() => useSessionTimeline());

    await act(async () => {
      await result.current.sendSessionMessage({
        message: 'Cancel me',
        permissionMode: 'default',
        model: 'deepseek-v4-flash',
      });
    });

    const startRequestId = session.message.send.mock.calls[0][0].requestId;
    const startTraceId = session.message.send.mock.calls[0][0].context.traceId;

    await act(async () => {
      await result.current.cancelSessionMessage();
    });

    expect(session.message.cancel).toHaveBeenCalledWith(expect.objectContaining({
      payload: {
        targetRequestId: startRequestId,
      },
      meta: expect.objectContaining({
        channel: IPC_CHANNELS.session.message.cancel,
        source: 'renderer',
      }),
      context: expect.objectContaining({
        traceId: startTraceId,
        operationName: 'session.message.cancel',
        source: 'renderer',
      }),
    }));
    expect(useChatUiStore.getState()).toMatchObject({
      agentStatus: 'idle',
    });
  });

  it('hydrates canonical timeline messages into chat stream state instead of old flat chat messages', async () => {
    const { session } = installMegumiMock();
    session.timeline.list.mockResolvedValueOnce({
      ok: true,
      data: {
        messages: [committedAssistant('assistant:run-history', 'run-history', 'Canonical answer')],
        diagnostics: [],
      },
    });
    useSessionStore.setState({
      sessions: [{
        id: 'session-1',
        projectId: 'project-1',
        agentType: 'free',
        title: 'History',
        createdAt: '2026-05-24T00:00:00.000Z',
        updatedAt: '2026-05-24T00:00:00.000Z',
      }],
      activeSessionId: 'session-1',
      activeAgentType: 'free',
    });
    const { result } = renderHook(() => useSessionHistoryHydration());

    await act(async () => {
      await result.current.hydrateSessionTimeline('session-1');
    });

    expect(session.timeline.list).toHaveBeenCalledWith(expect.objectContaining({
      payload: {
        projectId: 'project-1',
        sessionId: 'session-1',
      },
      meta: expect.objectContaining({
        channel: IPC_CHANNELS.session.timeline.list,
      }),
    }));
    expect(session.message.list).not.toHaveBeenCalled();
    expect(useChatStreamStore.getState().sessions[chatStreamSessionKey('project-1', 'session-1')].messages).toEqual([
      expect.objectContaining({
        messageId: 'assistant:run-history',
        role: 'assistant',
      }),
    ]);
  });

  it('drops stale history hydration responses after the active session changes', async () => {
    const { session, run } = installMegumiMock();
    const timelineDeferred = deferred<{
      ok: true;
      data: {
        messages: TimelineAssistantMessage[];
        diagnostics: [];
      };
    }>();
    session.timeline.list.mockReturnValueOnce(timelineDeferred.promise);
    useSessionStore.setState({
      sessions: [
        {
          id: 'session-1',
          projectId: 'project-1',
          agentType: 'free',
          title: 'First session',
          createdAt: '2026-05-24T00:00:00.000Z',
          updatedAt: '2026-05-24T00:00:00.000Z',
        },
        {
          id: 'session-2',
          projectId: 'project-1',
          agentType: 'free',
          title: 'Second session',
          createdAt: '2026-05-24T00:00:00.000Z',
          updatedAt: '2026-05-24T00:00:00.000Z',
        },
      ],
      activeSessionId: 'session-1',
      activeAgentType: 'free',
    });
    useRunStore.getState().applyRuntimeEvent(runtimeEvent({
      eventType: 'run.started',
      runId: 'run-current',
      sessionId: 'session-2',
    }));
    const { result } = renderHook(() => useSessionHistoryHydration());

    const hydratePromise = result.current.hydrateSessionTimeline('session-1');
    await waitFor(() => expect(session.timeline.list).toHaveBeenCalledTimes(1));

    act(() => {
      useSessionStore.getState().setActiveSession('session-2');
    });
    timelineDeferred.resolve({
      ok: true,
      data: {
        messages: [committedAssistant('assistant:run-stale', 'run-stale', 'Stale answer')],
        diagnostics: [],
      },
    });

    await act(async () => {
      await hydratePromise;
    });

    expect(run.listBySession).not.toHaveBeenCalled();
    expect(useRunStore.getState().runs).toHaveProperty('run-current');
    expect(useChatStreamStore.getState().sessions[chatStreamSessionKey('project-1', 'session-1')]).toBeUndefined();
  });

  it('keeps an in-flight streaming assistant message when history hydration returns a committed snapshot for the same run', async () => {
    const { session } = installMegumiMock();
    session.timeline.list.mockResolvedValueOnce({
      ok: true,
      data: {
        messages: [committedAssistant('assistant:run-live', 'run-live', 'Committed stale text')],
        diagnostics: [],
      },
    });
    useSessionStore.setState({
      sessions: [{
        id: 'session-1',
        projectId: 'project-1',
        agentType: 'free',
        title: 'History',
        createdAt: '2026-05-24T00:00:00.000Z',
        updatedAt: '2026-05-24T00:00:00.000Z',
      }],
      activeSessionId: 'session-1',
      activeAgentType: 'free',
    });
    useChatStreamStore.getState().dispatch({
      eventId: 'event-live-1',
      eventType: 'turn.started',
      projectId: 'project-1',
      sessionId: 'session-1',
      runId: 'run-live',
      streamId: 'stream-live',
      streamKind: 'main',
      seq: 1,
      createdAt: '2026-05-24T00:00:01.000Z',
      userMessageId: 'message-user-live',
    });
    useChatStreamStore.getState().dispatch({
      eventId: 'event-live-2',
      eventType: 'assistant.text.started',
      projectId: 'project-1',
      sessionId: 'session-1',
      runId: 'run-live',
      streamId: 'stream-live',
      streamKind: 'main',
      seq: 2,
      createdAt: '2026-05-24T00:00:02.000Z',
      textId: 'text-live',
      phase: 'answer',
    });
    useChatStreamStore.getState().dispatch({
      eventId: 'event-live-3',
      eventType: 'assistant.text.delta',
      projectId: 'project-1',
      sessionId: 'session-1',
      runId: 'run-live',
      streamId: 'stream-live',
      streamKind: 'main',
      seq: 3,
      createdAt: '2026-05-24T00:00:03.000Z',
      textId: 'text-live',
      phase: 'answer',
      delta: 'Streaming live text',
    });
    useChatStreamStore.getState().flushStream('project-1', 'session-1', 'stream-live');
    const { result } = renderHook(() => useSessionHistoryHydration());

    await act(async () => {
      await result.current.hydrateSessionTimeline('session-1');
    });

    const messages = useChatStreamStore.getState().sessions[chatStreamSessionKey('project-1', 'session-1')].messages;
    expect(messages).toEqual([
      expect.objectContaining({
        messageId: 'assistant:run-live',
        blocks: [
          expect.objectContaining({ kind: 'process_disclosure' }),
          expect.objectContaining({
            kind: 'answer_text',
            status: 'streaming',
            text: 'Streaming live text',
          }),
        ],
      }),
    ]);
    expect(JSON.stringify(messages)).not.toContain('Committed stale text');
  });
});
