// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { RuntimeIpcRequest } from '@megumi/shared/ipc-contracts';
import type { SessionMessageSendPayload } from '@megumi/shared/ipc-schemas';
import { useAgentStore } from '@megumi/desktop/renderer/entities/agent/store';
import { useChatStore } from '@megumi/desktop/renderer/entities/chat/store';
import { useProjectStore } from '@megumi/desktop/renderer/entities/project/store';
import { useWorkspaceStateStore } from '@megumi/desktop/renderer/entities/workspace-state';
import { AppShell } from '@megumi/desktop/renderer/shell/AppShell';
import { ThemeProvider } from '@megumi/desktop/renderer/shared/theme';

const { minimize, toggleMaximize, close } = vi.hoisted(() => ({
  minimize: vi.fn(),
  toggleMaximize: vi.fn(),
  close: vi.fn(),
}));

vi.mock('@megumi/desktop/renderer/shared/ipc/client', () => ({
  windowControls: {
    minimize,
    toggleMaximize,
    close,
  },
}));

let runtimeEventCallback: ((event: RuntimeEvent) => void) | null = null;
let sequence = 1;
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

function installMegumiMock() {
  runtimeEventCallback = null;
  sequence = 1;
  const chat = {
    start: vi.fn().mockImplementation((request: SessionMessageSendRequest) => Promise.resolve({
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
        message: {
          send: chat.start,
          cancel: chat.cancel,
        },
      },
      runtime: {
        onEvent: vi.fn((callback: (event: RuntimeEvent) => void) => {
          runtimeEventCallback = callback;
          return () => {
            runtimeEventCallback = null;
          };
        }),
      },
    },
  });

  return chat;
}

function latestRequest(chat: ReturnType<typeof installMegumiMock>): SessionMessageSendRequest {
  const request = chat.start.mock.calls.at(-1)?.[0] as SessionMessageSendRequest | undefined;

  if (!request) {
    throw new Error('Expected chat.start to have been called.');
  }

  return request;
}

function emitRuntimeSuccess(request: SessionMessageSendRequest, content: string) {
  act(() => {
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
  });
}

function emitRuntimeFailure(request: SessionMessageSendRequest, message: string) {
  act(() => {
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
  });
}

function resetStores() {
  useProjectStore.setState({
    projects: [
      {
        id: 'project-1',
        name: 'Megumi',
        description: 'Warm agent desktop companion',
        repoPath: 'C:/all/work/study/megumi',
        type: 'existing_feature',
        createdAt: '2026-05-10T00:00:00.000Z',
        context: {},
      },
    ],
    currentProjectId: 'project-1',
    loading: false,
  });

  useAgentStore.setState({
    sessions: [],
    activeSessionId: null,
    activeAgentType: 'free',
  });

  useChatStore.setState({
    messages: [],
    streamingText: '',
    isStreaming: false,
    pendingToolCalls: [],
    completedToolActivities: [],
    sessionSnapshots: {},
    agentStatus: 'idle',
    lastError: null,
  });

  useWorkspaceStateStore.setState({
    tasks: [],
    artifacts: [],
    memoryNotes: [],
    activeRunId: null,
  });
}

function renderAppShell() {
  return render(
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>,
  );
}

describe('interaction baseline acceptance', () => {
  beforeEach(() => {
    minimize.mockReset();
    toggleMaximize.mockReset();
    close.mockReset();
    vi.setSystemTime(new Date('2026-05-10T12:00:00.000Z'));
    installMegumiMock();
    resetStores();
  });

  afterEach(() => {
    runtimeEventCallback = null;
    vi.setSystemTime(new Date());
  });

  it('supports the complete runtime chat flow from shell chrome to right panel state', async () => {
    const chat = installMegumiMock();
    renderAppShell();

    expect(screen.getByTestId('window-titlebar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Minimize window' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Maximize or restore window' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close window' })).toBeInTheDocument();

    const modeSelect = screen.getByLabelText('Composer mode');
    const modelSelect = screen.getByLabelText('Model');
    const textarea = screen.getByLabelText('Message Megumi');
    const sendButton = screen.getByRole('button', { name: 'Send message' });

    fireEvent.change(modeSelect, { target: { value: 'agent' } });
    fireEvent.change(modelSelect, { target: { value: 'deepseek-v4-pro' } });
    fireEvent.change(textarea, { target: { value: 'Finish the interaction baseline' } });
    fireEvent.click(sendButton);
    await waitFor(() => expect(chat.start).toHaveBeenCalledTimes(1));
    const request = latestRequest(chat);

    const agentState = useAgentStore.getState();
    expect(agentState.sessions).toHaveLength(1);
    expect(agentState.activeSessionId).toBe(agentState.sessions[0].id);
    expect(agentState.sessions[0]).toMatchObject({
      title: 'Finish the interaction b...',
      projectId: 'project-1',
      agentType: 'free',
    });

    expect(request).toMatchObject({
      payload: expect.objectContaining({
        providerId: 'deepseek',
        modelId: 'deepseek-v4-pro',
        context: expect.objectContaining({
          composerMode: 'agent',
          workspaceId: 'project-1',
        }),
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: 'Finish the interaction baseline',
          }),
        ]),
      }),
      meta: expect.objectContaining({
        channel: IPC_CHANNELS.session.message.send,
        source: 'renderer',
      }),
    });
    expect(screen.getByText('Finish the interaction baseline')).toBeInTheDocument();
    expect(screen.getByText('Sending')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Tasks' }));

    expect(screen.getByText('Session tasks')).toBeInTheDocument();
    expect(screen.getByText('Runtime chat request')).toBeInTheDocument();
    expect(screen.getByText('Streaming provider response for "Finish the interaction baseline".')).toBeInTheDocument();

    emitRuntimeSuccess(request, 'Runtime response from deepseek-v4-pro for the interaction baseline.');
    expect(screen.getByText('Runtime response from deepseek-v4-pro for the interaction baseline.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Artifacts' }));

    expect(screen.getByText('Runtime response notes')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Memory' }));

    expect(screen.getByText('Session note')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Megumi completed "Finish the interaction baseline" in agent mode using deepseek-v4-pro.',
      ),
    ).toBeInTheDocument();
  });

  it('keeps right panel collapse and tab switching from clearing chat state', async () => {
    const chat = installMegumiMock();
    renderAppShell();

    const textarea = screen.getByLabelText('Message Megumi');
    const sendButton = screen.getByRole('button', { name: 'Send message' });

    fireEvent.change(textarea, { target: { value: 'Keep the conversation visible' } });
    fireEvent.click(sendButton);
    await waitFor(() => expect(chat.start).toHaveBeenCalledTimes(1));

    emitRuntimeSuccess(
      latestRequest(chat),
      'Runtime response from deepseek-v4-flash for the visible conversation.',
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Tasks' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Artifacts' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Memory' }));
    fireEvent.click(screen.getByRole('button', { name: 'Collapse workspace panel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Expand workspace panel' }));

    expect(screen.getByText('Keep the conversation visible')).toBeInTheDocument();
    expect(screen.getByText('Runtime response from deepseek-v4-flash for the visible conversation.')).toBeInTheDocument();
  });

  it('surfaces runtime failure as a timeline message without retrying on model switch', async () => {
    const chat = installMegumiMock();
    renderAppShell();

    const textarea = screen.getByLabelText('Message Megumi');
    const sendButton = screen.getByRole('button', { name: 'Send message' });

    fireEvent.change(textarea, { target: { value: 'please fail this run' } });
    fireEvent.click(sendButton);
    await waitFor(() => expect(chat.start).toHaveBeenCalledTimes(1));

    emitRuntimeFailure(latestRequest(chat), 'Runtime chat failed for "please fail this run".');

    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    expect(screen.getAllByText('Runtime chat failed for "please fail this run".').length).toBeGreaterThanOrEqual(1);

    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'deepseek-v4-flash' } });
    expect(chat.start).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('tab', { name: 'Tasks' }));

    expect(screen.getAllByText('Failed').length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText(
        'Runtime chat failed for "please fail this run".',
      ).length,
    ).toBeGreaterThanOrEqual(1);
  });
});
