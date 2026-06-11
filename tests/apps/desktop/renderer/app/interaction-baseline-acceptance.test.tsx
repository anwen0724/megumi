// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatStreamEvent } from '@megumi/shared/chat-stream';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import { IPC_CHANNELS } from '@megumi/shared/ipc';
import type { RuntimeIpcRequest } from '@megumi/shared/ipc';
import type { SessionMessageSendPayload } from '@megumi/shared/ipc';
import { useSessionStore } from '@megumi/desktop/renderer/entities/session/store';
import { useChatUiStore } from '@megumi/desktop/renderer/entities/chat-ui/store';
import { useProjectStore } from '@megumi/desktop/renderer/entities/project/store';
import { useArtifactStore } from '@megumi/desktop/renderer/entities/artifact/store';
import { useMemoryStore } from '@megumi/desktop/renderer/entities/memory/store';
import { useRunStore } from '@megumi/desktop/renderer/entities/run/store';
import { useWorkspaceFilesStore } from '@megumi/desktop/renderer/entities/workspace-files/store';
import App from '@megumi/desktop/renderer/app/App';
import {
  chatStreamSessionKey,
  useChatStreamStore,
} from '@megumi/desktop/renderer/features/chat-stream';

const { minimize, toggleMaximize, close } = vi.hoisted(() => ({
  minimize: vi.fn(),
  toggleMaximize: vi.fn(),
  close: vi.fn(),
}));
const scrollTo = vi.fn();

vi.mock('@megumi/desktop/renderer/shared/ipc/client', () => ({
  windowControls: {
    minimize,
    toggleMaximize,
    close,
  },
}));

let runtimeEventCallback: ((event: RuntimeEvent) => void) | null = null;
let chatStreamEventCallback: ((event: ChatStreamEvent) => void) | null = null;
let sequence = 1;
let chatStreamSequence = 1;
type SessionMessageSendRequest = RuntimeIpcRequest<
  SessionMessageSendPayload,
  typeof IPC_CHANNELS.session.message.send
>;

function emitRuntimeEvent(event: Omit<RuntimeEvent, 'eventId' | 'schemaVersion' | 'sequence' | 'createdAt' | 'source' | 'visibility' | 'persist'> & {
  source?: RuntimeEvent['source'];
  visibility?: RuntimeEvent['visibility'];
  persist?: RuntimeEvent['persist'];
}) {
  runtimeEventCallback?.({
    eventId: `event-${sequence}`,
    schemaVersion: 1,
    sequence: sequence++,
    createdAt: '2026-05-10T12:00:00.000Z',
    source: event.source ?? 'provider',
    visibility: event.visibility ?? 'user',
    persist: event.persist ?? 'required',
    ...event,
  } as RuntimeEvent);
}

function emitChatStreamEvent(
  request: SessionMessageSendRequest,
  event: Partial<ChatStreamEvent> & Pick<ChatStreamEvent, 'eventType'>,
) {
  const seq = chatStreamSequence++;
  chatStreamEventCallback?.({
    eventId: `chat-stream-event-${seq}`,
    projectId: request.payload.context?.workspaceId ?? 'project-1',
    sessionId: request.payload.sessionId ?? useSessionStore.getState().activeSessionId ?? 'session-1',
    runId: `${request.requestId}-run`,
    streamId: `${request.requestId}-stream`,
    streamKind: 'main',
    seq,
    createdAt: `2026-05-10T12:00:00.${String(seq).padStart(3, '0')}Z`,
    ...event,
  } as ChatStreamEvent);
}

function installMegumiMock() {
  runtimeEventCallback = null;
  chatStreamEventCallback = null;
  sequence = 1;
  chatStreamSequence = 1;
  const session = {
    message: {
      send: vi.fn().mockImplementation((request: SessionMessageSendRequest) => Promise.resolve({
        ok: true,
        data: { requestId: request.requestId },
        meta: {
          requestId: request.requestId,
          channel: IPC_CHANNELS.session.message.send,
          handledAt: '2026-05-10T12:00:00.100Z',
        },
      })),
      cancel: vi.fn().mockResolvedValue({
        ok: true,
        data: { cancelled: true },
        meta: {
          requestId: 'ipc-session-message-cancel-1',
          channel: IPC_CHANNELS.session.message.cancel,
          handledAt: '2026-05-10T12:00:00.100Z',
        },
      }),
    },
  };

  Object.defineProperty(window, 'megumi', {
    configurable: true,
    value: {
      provider: {
        list: vi.fn().mockResolvedValue({
          ok: true,
          data: { providers: [] },
          meta: {
            requestId: 'ipc-provider-list-1',
            channel: IPC_CHANNELS.provider.list,
            handledAt: '2026-05-10T12:00:00.100Z',
          },
        }),
        update: vi.fn().mockResolvedValue({ ok: true, data: {}, meta: {} }),
        setApiKey: vi.fn().mockResolvedValue({ ok: true, data: {}, meta: {} }),
        deleteApiKey: vi.fn().mockResolvedValue({ ok: true, data: {}, meta: {} }),
      },
      session: {
        list: vi.fn().mockResolvedValue({
          ok: true,
          data: { sessions: [] },
          meta: {
            requestId: 'ipc-session-list-1',
            channel: IPC_CHANNELS.session.list,
            handledAt: '2026-05-10T12:00:00.100Z',
          },
        }),
        message: {
          send: session.message.send,
          cancel: session.message.cancel,
          list: vi.fn().mockResolvedValue({
            ok: true,
            data: { messages: [] },
            meta: {
              requestId: 'ipc-session-message-list-1',
              channel: IPC_CHANNELS.session.message.list,
              handledAt: '2026-05-10T12:00:00.100Z',
            },
          }),
        },
      },
      run: {
        listBySession: vi.fn().mockResolvedValue({
          ok: true,
          data: { runs: [] },
          meta: {
            requestId: 'ipc-run-list-by-session-1',
            channel: IPC_CHANNELS.run.listBySession,
            handledAt: '2026-05-10T12:00:00.100Z',
          },
        }),
        events: {
          list: vi.fn().mockResolvedValue({
            ok: true,
            data: { events: [] },
            meta: {
              requestId: 'ipc-run-events-list-1',
              channel: IPC_CHANNELS.run.events.list,
              handledAt: '2026-05-10T12:00:00.100Z',
            },
          }),
        },
      },
      project: {
        list: vi.fn().mockResolvedValue({
          ok: true,
          data: {
            projects: [{
              projectId: 'project-1',
              name: 'Megumi',
              repoPath: 'C:/all/work/study/megumi',
              repoPathKey: 'c:/all/work/study/megumi',
              status: 'available',
              createdAt: '2026-05-10T00:00:00.000Z',
              lastOpenedAt: '2026-05-10T00:00:00.000Z',
            }],
          },
          meta: {
            requestId: 'ipc-project-list-1',
            channel: IPC_CHANNELS.project.list,
            handledAt: '2026-05-10T12:00:00.100Z',
          },
        }),
        useExisting: vi.fn().mockResolvedValue({
          ok: true,
          data: { cancelled: true },
          meta: {
            requestId: 'ipc-project-use-existing-1',
            channel: IPC_CHANNELS.project.useExisting,
            handledAt: '2026-05-10T12:00:00.100Z',
          },
        }),
        open: vi.fn(),
        remove: vi.fn(),
      },
      runtime: {
        onEvent: vi.fn((callback: (event: RuntimeEvent) => void) => {
          runtimeEventCallback = callback;
          return () => {
            runtimeEventCallback = null;
          };
        }),
      },
      chatStream: {
        onEvent: vi.fn((callback: (event: ChatStreamEvent) => void) => {
          chatStreamEventCallback = callback;
          return () => {
            chatStreamEventCallback = null;
          };
        }),
      },
      workspace: {
        files: {
          list: vi.fn().mockImplementation((request: { payload: { workspaceRoot: string; directoryPath: string } }) => Promise.resolve({
            ok: true,
            data: {
              workspaceRoot: request.payload.workspaceRoot,
              directoryPath: request.payload.directoryPath,
              entries: [],
            },
            meta: {
              requestId: 'ipc-workspace-files-list-1',
              channel: IPC_CHANNELS.workspace.files.list,
              handledAt: '2026-05-10T12:00:00.100Z',
            },
          })),
        },
      },
    },
  });

  return session;
}

function latestSessionMessageSendRequest(session: ReturnType<typeof installMegumiMock>): SessionMessageSendRequest {
  const request = session.message.send.mock.calls.at(-1)?.[0] as SessionMessageSendRequest | undefined;

  if (!request) {
    throw new Error('Expected session.message.send to have been called.');
  }

  return request;
}

function emitRuntimeSuccess(request: SessionMessageSendRequest, content: string) {
  act(() => {
    const currentUserMessage = request.payload.message ?? request.payload.messages?.at(-1);
    const clientMessageId = String(currentUserMessage?.id ?? 'client-message-1');
    const userText = currentUserMessage?.content ?? '';

    emitRuntimeEvent({
      eventType: 'run.started',
      requestId: request.requestId,
      runId: `${request.requestId}-run`,
      source: 'core',
      visibility: 'system',
      payload: {
        providerId: request.payload.providerId,
        modelId: request.payload.modelId,
        runKind: 'chat',
      },
    });
    emitRuntimeEvent({
      eventType: 'assistant.output.delta',
      requestId: request.requestId,
      runId: `${request.requestId}-run`,
      persist: 'transient',
      payload: {
        delta: content,
      },
    });
    emitRuntimeEvent({
      eventType: 'assistant.output.completed',
      requestId: request.requestId,
      runId: `${request.requestId}-run`,
      visibility: 'system',
      payload: {
        content,
      },
    });
    emitRuntimeEvent({
      eventType: 'run.completed',
      requestId: request.requestId,
      runId: `${request.requestId}-run`,
      source: 'core',
      visibility: 'system',
      payload: {},
    });
    emitChatStreamEvent(request, {
      eventType: 'turn.started',
      userMessageId: `message-${clientMessageId}`,
      clientMessageId,
    });
    emitChatStreamEvent(request, {
      eventType: 'user.message.committed',
      clientMessageId,
      messageId: `message-${clientMessageId}`,
      text: userText,
    });
    emitChatStreamEvent(request, {
      eventType: 'assistant.text.started',
      textId: `${request.requestId}-answer`,
      phase: 'answer',
    });
    emitChatStreamEvent(request, {
      eventType: 'assistant.text.delta',
      textId: `${request.requestId}-answer`,
      phase: 'answer',
      delta: content,
    });
    emitChatStreamEvent(request, {
      eventType: 'assistant.text.completed',
      textId: `${request.requestId}-answer`,
      phase: 'answer',
    });
    emitChatStreamEvent(request, {
      eventType: 'turn.completed',
    });
  });
}

function emitRuntimeFailure(request: SessionMessageSendRequest, message: string) {
  act(() => {
    const currentUserMessage = request.payload.message ?? request.payload.messages?.at(-1);
    const clientMessageId = String(currentUserMessage?.id ?? 'client-message-1');
    const userText = currentUserMessage?.content ?? '';

    emitRuntimeEvent({
      eventType: 'run.failed',
      requestId: request.requestId,
      runId: `${request.requestId}-run`,
      source: 'provider',
      payload: {
        error: {
          code: 'provider_network_error',
          message,
          severity: 'error',
          retryable: true,
          source: 'provider',
          details: {
            providerId: request.payload.providerId,
            modelId: request.payload.modelId,
          },
        },
      },
    });
    emitChatStreamEvent(request, {
      eventType: 'turn.started',
      userMessageId: `message-${clientMessageId}`,
      clientMessageId,
    });
    emitChatStreamEvent(request, {
      eventType: 'user.message.committed',
      clientMessageId,
      messageId: `message-${clientMessageId}`,
      text: userText,
    });
    emitChatStreamEvent(request, {
      eventType: 'turn.failed',
      errorCode: 'provider_network_error',
      errorMessage: message,
      recoverable: true,
    });
  });
}

function resetStores() {
  useProjectStore.setState({
    projects: [
      {
        id: 'project-1',
        name: 'Megumi',
        repoPath: 'C:/all/work/study/megumi',
        createdAt: '2026-05-10T00:00:00.000Z',
        projectId: 'project-1',
        repoPathKey: 'c:/all/work/study/megumi',
        lastOpenedAt: '2026-05-19T00:00:00.000Z',
        status: 'available' as const,
      },
    ],
    currentProjectId: 'project-1',
    loading: false,
  });

  useSessionStore.setState({
    sessions: [],
    activeSessionId: null,
    activeAgentType: 'free',
  });

  useChatUiStore.setState({
    activeSessionId: null,
    agentStatus: 'idle',
    lastError: null,
    sessionStates: {},
  });

  useRunStore.getState().resetRuns();
  useChatStreamStore.getState().reset();
  useWorkspaceFilesStore.getState().reset();
  useArtifactStore.getState().clearArtifacts();
  useMemoryStore.setState({
    settings: undefined,
    candidates: [],
    memories: [],
    selectedMemory: undefined,
    selectedSourceRefs: [],
    accessLogs: [],
    recallPreview: undefined,
    loading: false,
    error: undefined,
  });
}

function renderApp() {
  return render(<App />);
}

function activeCanonicalMessages() {
  const activeSessionId = useSessionStore.getState().activeSessionId;

  if (!activeSessionId) {
    throw new Error('Expected an active session.');
  }

  return useChatStreamStore.getState().sessions[
    chatStreamSessionKey('project-1', activeSessionId)
  ].messages;
}

function expectCanonicalUserText(text: string) {
  expect(activeCanonicalMessages()).toEqual(expect.arrayContaining([
    expect.objectContaining({
      role: 'user',
      blocks: [expect.objectContaining({
        kind: 'user_text',
        text,
      })],
    }),
  ]));
}

function expectCanonicalAssistantAnswer(text: string) {
  expect(activeCanonicalMessages()).toEqual(expect.arrayContaining([
    expect.objectContaining({
      role: 'assistant',
      blocks: expect.arrayContaining([
        expect.objectContaining({
          kind: 'answer_text',
          status: 'completed',
          text,
        }),
      ]),
    }),
  ]));
}

describe('interaction baseline acceptance', () => {
  beforeEach(() => {
    minimize.mockReset();
    toggleMaximize.mockReset();
    close.mockReset();
    scrollTo.mockReset();
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: scrollTo,
    });
    vi.setSystemTime(new Date('2026-05-10T12:00:00.000Z'));
    installMegumiMock();
    resetStores();
  });

  afterEach(() => {
    runtimeEventCallback = null;
    chatStreamEventCallback = null;
    vi.setSystemTime(new Date());
  });

  it('supports the complete runtime chat flow from shell chrome to right panel state', async () => {
    const session = installMegumiMock();
    renderApp();

    expect(screen.getByTestId('window-titlebar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Minimize window' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Maximize or restore window' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close window' })).toBeInTheDocument();

    const modeSelect = screen.getByLabelText('Permission mode');
    const modelSelect = screen.getByLabelText('Model');
    const textarea = screen.getByLabelText('Message Megumi');
    const sendButton = screen.getByRole('button', { name: 'Send message' });

    fireEvent.change(modeSelect, { target: { value: 'auto' } });
    fireEvent.change(modelSelect, { target: { value: 'deepseek-v4-pro' } });
    fireEvent.change(textarea, { target: { value: 'Finish the interaction baseline' } });
    fireEvent.click(sendButton);
    await waitFor(() => expect(session.message.send).toHaveBeenCalledTimes(1));
    const request = latestSessionMessageSendRequest(session);

    const agentState = useSessionStore.getState();
    expect(agentState.sessions).toHaveLength(1);
    expect(agentState.activeSessionId).toBe(agentState.sessions[0].id);
    expect(agentState.sessions[0]).toMatchObject({
      title: 'Finish the interaction b...',
      projectId: 'project-1',
      agentType: 'free',
    });
    expectCanonicalUserText('Finish the interaction baseline');
    expect(await screen.findByText('Finish the interaction baseline')).toBeInTheDocument();

    expect(request).toMatchObject({
      payload: expect.objectContaining({
        providerId: 'deepseek',
        modelId: 'deepseek-v4-pro',
        context: expect.objectContaining({
          permissionMode: 'auto',
          workspaceId: 'project-1',
        }),
        message: expect.objectContaining({
          content: 'Finish the interaction baseline',
        }),
      }),
      meta: expect.objectContaining({
        channel: IPC_CHANNELS.session.message.send,
        source: 'renderer',
      }),
    });
    expect(screen.queryByText('Sending')).not.toBeInTheDocument();

    emitRuntimeSuccess(request, 'Runtime response from deepseek-v4-pro for the interaction baseline.');
    expectCanonicalAssistantAnswer('Runtime response from deepseek-v4-pro for the interaction baseline.');
    expect(await screen.findByText('Runtime response from deepseek-v4-pro for the interaction baseline.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open project sidebar' }));
    expect(screen.getByRole('heading', { name: 'Project' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Files project view' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Tasks' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Run' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Context' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Memory' })).not.toBeInTheDocument();
    expect(screen.queryByText('No project selected')).not.toBeInTheDocument();

    expect(screen.getAllByText('Megumi').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Runtime chat request')).not.toBeInTheDocument();
    expect(screen.queryByText('Mock agent run')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open Artifacts project view' }));

    expect(screen.getByText('No artifacts yet')).toBeInTheDocument();

    expect(screen.queryByText('No pending candidates.')).not.toBeInTheDocument();
    expect(screen.queryByText('No active memories.')).not.toBeInTheDocument();
  });

  it('keeps right sidebar close and workspace switching from clearing chat state', async () => {
    const session = installMegumiMock();
    renderApp();

    const textarea = screen.getByLabelText('Message Megumi');
    const sendButton = screen.getByRole('button', { name: 'Send message' });

    fireEvent.change(textarea, { target: { value: 'Keep the conversation visible' } });
    fireEvent.click(sendButton);
    await waitFor(() => expect(session.message.send).toHaveBeenCalledTimes(1));

    emitRuntimeSuccess(
      latestSessionMessageSendRequest(session),
      'Runtime response from deepseek-v4-flash for the visible conversation.',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open project sidebar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Artifacts project view' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to Project' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Files project view' }));
    expect(screen.queryByRole('tab', { name: 'Context' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Memory' })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Close project sidebar' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Open project sidebar' }));

    expectCanonicalUserText('Keep the conversation visible');
    expectCanonicalAssistantAnswer('Runtime response from deepseek-v4-flash for the visible conversation.');
    expect(await screen.findByText('Keep the conversation visible')).toBeInTheDocument();
    expect(await screen.findByText('Runtime response from deepseek-v4-flash for the visible conversation.')).toBeInTheDocument();
  });

  it('surfaces runtime failure as a timeline message without retrying on model switch', async () => {
    const session = installMegumiMock();
    renderApp();

    const textarea = screen.getByLabelText('Message Megumi');
    const sendButton = screen.getByRole('button', { name: 'Send message' });

    fireEvent.change(textarea, { target: { value: 'please fail this run' } });
    fireEvent.click(sendButton);
    await waitFor(() => expect(session.message.send).toHaveBeenCalledTimes(1));

    emitRuntimeFailure(latestSessionMessageSendRequest(session), 'Runtime chat failed for "please fail this run".');

    expect(useChatUiStore.getState().lastError).toBe('Runtime chat failed for "please fail this run".');
    expect(screen.queryByText('Needs attention')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    const activeSessionId = useSessionStore.getState().activeSessionId;
    expect(useChatStreamStore.getState().sessions[
      chatStreamSessionKey('project-1', activeSessionId ?? '')
    ].messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'assistant',
        blocks: [expect.objectContaining({
          kind: 'process_disclosure',
          status: 'failed',
          items: [expect.objectContaining({
            kind: 'error_activity',
            errorMessage: 'Runtime chat failed for "please fail this run".',
          })],
        })],
      }),
    ]));

    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'deepseek-v4-flash' } });
    expect(session.message.send).toHaveBeenCalledTimes(1);

    expect(screen.queryByRole('tab', { name: 'Tasks' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Context' })).not.toBeInTheDocument();

    expect(useChatUiStore.getState().lastError).toBe('Runtime chat failed for "please fail this run".');
  });
});

