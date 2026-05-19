// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import { useSessionStore } from '@megumi/desktop/renderer/entities/session/store';
import { useArtifactStore } from '@megumi/desktop/renderer/entities/artifact';
import { useChatStore } from '@megumi/desktop/renderer/entities/chat/store';
import { useProjectStore } from '@megumi/desktop/renderer/entities/project/store';
import { useRunStore } from '@megumi/desktop/renderer/entities/run/store';
import { useSessionTimeline } from '@megumi/desktop/renderer/features/chat/hooks/use-session-timeline';

let runtimeEventCallback: ((event: RuntimeEvent) => void) | null = null;
let sequence = 1;

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

function installMegumiMock() {
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
    },
  });

  return { session, runtime };
}

describe('useSessionTimeline', () => {
  beforeEach(() => {
    runtimeEventCallback = null;
    sequence = 1;
    useChatStore.setState({
      messages: [],
      streamingText: '',
      isStreaming: false,
      pendingToolCalls: [],
      completedToolActivities: [],
      agentStatus: 'idle',
      lastError: null,
      sessionSnapshots: {},
    });
    useSessionStore.setState({
      sessions: [],
      activeSessionId: null,
      activeAgentType: 'free',
    });
    useProjectStore.setState({
      currentProjectId: null,
      projects: [],
    });
    useArtifactStore.getState().clearArtifacts();
    useRunStore.getState().resetRuns();
  });

  it('starts backend chat with an ipc request envelope, creates a session, and applies stream events', async () => {
    const { session } = installMegumiMock();
    useProjectStore.setState({
      currentProjectId: 'project-1',
      projects: [{
        id: 'project-1',
        name: 'Megumi',
        description: 'Megumi workspace',
        repoPath: 'C:/all/work/study/megumi',
        type: 'existing_feature',
        createdAt: '2026-05-12T00:00:00.000Z',
        context: {},
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
        mode: 'chat',
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
          composerMode: 'chat',
          sessionTitle: 'Hello Megumi',
        }),
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: 'Hello Megumi',
          }),
        ]),
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
    expect(useSessionStore.getState().sessions[0].title).toBe('Hello Megumi');
    expect(useChatStore.getState().messages[0]).toMatchObject({
      role: 'user',
      content: 'Hello Megumi',
    });
    expect(useChatStore.getState().agentStatus).toBe('sending');

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

    expect(useChatStore.getState().agentStatus).toBe('running');
    expect(useChatStore.getState().streamingText).toBe('Hi there');

    act(() => {
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

    expect(useChatStore.getState().messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: 'Hi there',
    });
    expect(useChatStore.getState().agentStatus).toBe('idle');
  });

  it('does not synthesize artifact state from completed runtime chat output', async () => {
    const { session } = installMegumiMock();
    const { result } = renderHook(() => useSessionTimeline());

    await act(async () => {
      await result.current.sendSessionMessage({
        message: 'Summarize runtime chat',
        mode: 'execute',
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

  it('turns session message send failure envelopes into assistant messages', async () => {
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
        mode: 'chat',
        model: 'gpt-4.1',
      });
    });

    expect(useChatStore.getState()).toMatchObject({
      agentStatus: 'error',
      lastError: 'Provider API key is missing.',
    });
    expect(useChatStore.getState().messages.map((message) => [message.role, message.content])).toEqual([
      ['user', 'Use OpenAI'],
      ['assistant', 'Provider API key is missing.'],
    ]);
  });

  it('commits completed assistant output when no deltas arrived', async () => {
    const { session } = installMegumiMock();
    const { result } = renderHook(() => useSessionTimeline());

    await act(async () => {
      await result.current.sendSessionMessage({
        message: 'Return final only',
        mode: 'chat',
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

    expect(useChatStore.getState().messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: 'Complete response without deltas',
    });
  });

  it('persists failed runtime stream events as assistant messages', async () => {
    const { session } = installMegumiMock();
    const { result } = renderHook(() => useSessionTimeline());

    await act(async () => {
      await result.current.sendSessionMessage({
        message: 'Use unsupported provider',
        mode: 'chat',
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

    expect(useChatStore.getState().messages.map((message) => [message.role, message.content])).toEqual([
      ['user', 'Use unsupported provider'],
      ['assistant', 'Provider is disabled.'],
    ]);
  });

  it('retries the failed message with the current model override', async () => {
    const { session } = installMegumiMock();
    const { result } = renderHook(() => useSessionTimeline());

    await act(async () => {
      await result.current.sendSessionMessage({
        message: 'Try Claude first',
        mode: 'chat',
        model: 'claude-opus-4-7',
      });
    });

    await act(async () => {
      await result.current.retryLastSessionMessage({
        mode: 'chat',
        model: 'deepseek-v4-flash',
      });
    });

    expect(session.message.send).toHaveBeenCalledTimes(2);
    expect(session.message.send.mock.calls[1][0]).toMatchObject({
      payload: expect.objectContaining({
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: 'Try Claude first',
          }),
        ]),
      }),
    });
  });

  it('cancels session messages using a runtime ipc cancel request envelope', async () => {
    const { session } = installMegumiMock();
    const { result } = renderHook(() => useSessionTimeline());

    await act(async () => {
      await result.current.sendSessionMessage({
        message: 'Cancel me',
        mode: 'chat',
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
  });
});
