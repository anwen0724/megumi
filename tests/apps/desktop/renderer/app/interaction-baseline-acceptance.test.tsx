// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { RuntimeIpcRequest } from '@megumi/shared/ipc-contracts';
import type { SessionMessageSendPayload } from '@megumi/shared/ipc-schemas';
import { useSessionStore } from '@megumi/desktop/renderer/entities/session/store';
import { useChatStore } from '@megumi/desktop/renderer/entities/chat/store';
import { useProjectStore } from '@megumi/desktop/renderer/entities/project/store';
import { useArtifactStore } from '@megumi/desktop/renderer/entities/artifact/store';
import { useMemoryStore } from '@megumi/desktop/renderer/entities/memory/store';
import { useRunStore } from '@megumi/desktop/renderer/entities/run/store';
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
        message: {
          send: session.message.send,
          cancel: session.message.cancel,
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

  useSessionStore.setState({
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

  useRunStore.getState().resetRuns();
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
    const session = installMegumiMock();
    renderAppShell();

    expect(screen.getByTestId('window-titlebar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Minimize window' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Maximize or restore window' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close window' })).toBeInTheDocument();

    const modeSelect = screen.getByLabelText('Composer mode');
    const modelSelect = screen.getByLabelText('Model');
    const textarea = screen.getByLabelText('Message Megumi');
    const sendButton = screen.getByRole('button', { name: 'Send message' });

    fireEvent.change(modeSelect, { target: { value: 'execute' } });
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

    expect(request).toMatchObject({
      payload: expect.objectContaining({
        providerId: 'deepseek',
        modelId: 'deepseek-v4-pro',
        context: expect.objectContaining({
          composerMode: 'execute',
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

    emitRuntimeSuccess(request, 'Runtime response from deepseek-v4-pro for the interaction baseline.');
    expect(screen.getByText('Runtime response from deepseek-v4-pro for the interaction baseline.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Tasks' }));

    expect(screen.getByText('Session tasks')).toBeInTheDocument();
    expect(screen.getByText('Completed session message')).toBeInTheDocument();
    expect(screen.queryByText('Runtime chat request')).not.toBeInTheDocument();
    expect(screen.queryByText('Mock agent run')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Artifacts' }));

    expect(screen.getByText('No artifacts yet')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Memory' }));

    expect(screen.getByText('No pending candidates.')).toBeInTheDocument();
    expect(screen.getByText('No active memories.')).toBeInTheDocument();
  });

  it('keeps right panel collapse and tab switching from clearing chat state', async () => {
    const session = installMegumiMock();
    renderAppShell();

    const textarea = screen.getByLabelText('Message Megumi');
    const sendButton = screen.getByRole('button', { name: 'Send message' });

    fireEvent.change(textarea, { target: { value: 'Keep the conversation visible' } });
    fireEvent.click(sendButton);
    await waitFor(() => expect(session.message.send).toHaveBeenCalledTimes(1));

    emitRuntimeSuccess(
      latestSessionMessageSendRequest(session),
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
    const session = installMegumiMock();
    renderAppShell();

    const textarea = screen.getByLabelText('Message Megumi');
    const sendButton = screen.getByRole('button', { name: 'Send message' });

    fireEvent.change(textarea, { target: { value: 'please fail this run' } });
    fireEvent.click(sendButton);
    await waitFor(() => expect(session.message.send).toHaveBeenCalledTimes(1));

    emitRuntimeFailure(latestSessionMessageSendRequest(session), 'Runtime chat failed for "please fail this run".');

    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    expect(screen.getAllByText('Runtime chat failed for "please fail this run".').length).toBeGreaterThanOrEqual(1);

    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'deepseek-v4-flash' } });
    expect(session.message.send).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('tab', { name: 'Tasks' }));

    expect(screen.getByText('Failed session message')).toBeInTheDocument();
    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(
      screen.getAllByText(
        'Runtime chat failed for "please fail this run".',
      ).length,
    ).toBeGreaterThanOrEqual(1);
  });
});
