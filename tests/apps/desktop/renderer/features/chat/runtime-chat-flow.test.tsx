// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import { useAgentStore } from '@megumi/desktop/renderer/entities/agent/store';
import { useChatStore } from '@megumi/desktop/renderer/entities/chat/store';
import { useProjectStore } from '@megumi/desktop/renderer/entities/project/store';
import { useRuntimeChat } from '@megumi/desktop/renderer/features/chat/hooks/use-runtime-chat';

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
  const chat = {
    start: vi.fn().mockImplementation((request) => Promise.resolve({
      ok: true,
      data: {
        requestId: request.requestId,
      },
      meta: {
        requestId: request.requestId,
        channel: IPC_CHANNELS.chat.start,
        handledAt: '2026-05-12T00:00:00.100Z',
      },
    })),
    cancel: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        cancelled: true,
      },
      meta: {
        requestId: 'ipc-chat-cancel-1',
        channel: IPC_CHANNELS.chat.cancel,
        handledAt: '2026-05-12T00:00:00.100Z',
      },
    }),
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
      chat,
      provider: {
        list: vi.fn(),
        update: vi.fn(),
        setApiKey: vi.fn(),
        deleteApiKey: vi.fn(),
      },
      runtime,
    },
  });

  return { chat, runtime };
}

describe('useRuntimeChat', () => {
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
    useAgentStore.setState({
      sessions: [],
      activeSessionId: null,
      activeAgentType: 'free',
    });
    useProjectStore.setState({
      currentProjectId: null,
      projects: [],
    });
  });

  it('starts backend chat with an ipc request envelope, creates a session, and applies stream events', async () => {
    const { chat } = installMegumiMock();
    const { result } = renderHook(() => useRuntimeChat());

    await act(async () => {
      await result.current.runRuntimeChat({
        message: 'Hello Megumi',
        mode: 'chat',
        model: 'deepseek-v4-flash',
      });
    });

    expect(chat.start).toHaveBeenCalledWith(expect.objectContaining({
      requestId: expect.stringMatching(/^ipc-chat-/),
      payload: expect.objectContaining({
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        context: expect.objectContaining({
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
        channel: IPC_CHANNELS.chat.start,
        source: 'renderer',
      }),
    }));
    const requestId = chat.start.mock.calls[0][0].requestId;
    expect(useAgentStore.getState().sessions[0].title).toBe('Hello Megumi');
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

  it('turns chat start failure envelopes into assistant messages', async () => {
    const { chat } = installMegumiMock();
    chat.start.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'provider_missing_api_key',
        message: 'Provider API key is missing.',
        severity: 'error',
        retryable: false,
        source: 'provider',
      },
      meta: {
        requestId: 'ipc-chat-start-1',
        channel: IPC_CHANNELS.chat.start,
        handledAt: '2026-05-12T00:00:00.100Z',
      },
    });
    const { result } = renderHook(() => useRuntimeChat());

    await act(async () => {
      await result.current.runRuntimeChat({
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
    const { chat } = installMegumiMock();
    const { result } = renderHook(() => useRuntimeChat());

    await act(async () => {
      await result.current.runRuntimeChat({
        message: 'Return final only',
        mode: 'chat',
        model: 'deepseek-v4-flash',
      });
    });

    const requestId = chat.start.mock.calls[0][0].requestId;

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
    const { chat } = installMegumiMock();
    const { result } = renderHook(() => useRuntimeChat());

    await act(async () => {
      await result.current.runRuntimeChat({
        message: 'Use unsupported provider',
        mode: 'chat',
        model: 'claude-opus-4-7',
      });
    });

    act(() => {
      const requestId = chat.start.mock.calls[0][0].requestId;
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
    const { chat } = installMegumiMock();
    const { result } = renderHook(() => useRuntimeChat());

    await act(async () => {
      await result.current.runRuntimeChat({
        message: 'Try Claude first',
        mode: 'chat',
        model: 'claude-opus-4-7',
      });
    });

    await act(async () => {
      await result.current.retryLastRuntimeChat({
        mode: 'chat',
        model: 'deepseek-v4-flash',
      });
    });

    expect(chat.start).toHaveBeenCalledTimes(2);
    expect(chat.start.mock.calls[1][0]).toMatchObject({
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

  it('cancels chat using a runtime ipc cancel request envelope', async () => {
    const { chat } = installMegumiMock();
    const { result } = renderHook(() => useRuntimeChat());

    await act(async () => {
      await result.current.runRuntimeChat({
        message: 'Cancel me',
        mode: 'chat',
        model: 'deepseek-v4-flash',
      });
    });

    const startRequestId = chat.start.mock.calls[0][0].requestId;

    await act(async () => {
      await result.current.cancelRuntimeChat();
    });

    expect(chat.cancel).toHaveBeenCalledWith(expect.objectContaining({
      payload: {
        targetRequestId: startRequestId,
      },
      meta: expect.objectContaining({
        channel: IPC_CHANNELS.chat.cancel,
        source: 'renderer',
      }),
    }));
  });
});
