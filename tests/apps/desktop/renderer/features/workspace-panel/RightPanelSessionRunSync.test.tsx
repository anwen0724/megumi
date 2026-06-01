// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { RuntimeIpcRequest } from '@megumi/shared/ipc-contracts';
import type { SessionMessageSendPayload } from '@megumi/shared/ipc-schemas';
import { useArtifactStore } from '@megumi/desktop/renderer/entities/artifact';
import { useChatUiStore } from '@megumi/desktop/renderer/entities/chat-ui/store';
import { useMemoryStore } from '@megumi/desktop/renderer/entities/memory/store';
import { useProjectStore } from '@megumi/desktop/renderer/entities/project/store';
import { useRunStore } from '@megumi/desktop/renderer/entities/run/store';
import { useWorkspaceFilesStore } from '@megumi/desktop/renderer/entities/workspace-files/store';
import { ChatTimeline } from '@megumi/desktop/renderer/features/chat';
import { RightWorkspacePanel } from '@megumi/desktop/renderer/shell/RightWorkspacePanel';

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

function emitRuntimeStarted(request: SessionMessageSendRequest) {
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
  });
}

function emitRuntimeSuccess(request: SessionMessageSendRequest, content: string) {
  act(() => {
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
    projects: [{
      id: 'project-1',
      projectId: 'project-1',
      name: 'Megumi',
      repoPath: 'C:/all/work/study/megumi',
      repoPathKey: 'c:/all/work/study/megumi',
      status: 'available' as const,
      createdAt: '2026-05-10T00:00:00.000Z',
      lastOpenedAt: '2026-05-19T00:00:00.000Z',
    }],
    currentProjectId: 'project-1',
    loading: false,
  });
  useChatUiStore.setState({
    activeSessionId: null,
    agentStatus: 'idle',
    lastError: null,
    sessionStates: {},
  });
  useRunStore.getState().resetRuns();
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

function renderChatWithRightPanel() {
  return render(
    <div className="flex h-screen">
      <ChatTimeline />
      <RightWorkspacePanel collapsed={false} onToggleCollapsed={() => undefined} />
    </div>,
  );
}

describe('right workspace panel session run sync', () => {
  beforeEach(() => {
    installMegumiMock();
    resetStores();
  });

  afterEach(() => {
    runtimeEventCallback = null;
  });

  it('keeps runtime-only run state out of canonical timeline messages without mock workspace rows', async () => {
    const session = installMegumiMock();
    renderChatWithRightPanel();

    const modeSelect = screen.getByLabelText('Permission mode');
    const modelSelect = screen.getByLabelText('Model');
    const textarea = screen.getByLabelText('Message Megumi');
    const sendButton = screen.getByRole('button', { name: 'Send message' });

    fireEvent.change(modeSelect, { target: { value: 'auto' } });
    fireEvent.change(modelSelect, { target: { value: 'deepseek-v4-pro' } });
    fireEvent.change(textarea, { target: { value: 'Start with the shell' } });
    fireEvent.click(sendButton);
    await waitFor(() => expect(session.message.send).toHaveBeenCalledTimes(1));
    const request = latestSessionMessageSendRequest(session);
    emitRuntimeStarted(request);

    expect(screen.getByText('Start with the shell')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop current run' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Tasks' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Run' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Context' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Memory' })).not.toBeInTheDocument();
    expect(screen.queryByText('Runtime chat request')).not.toBeInTheDocument();
    expect(screen.queryByText('Mock agent run')).not.toBeInTheDocument();

    expect(request.requestId).toBe(session.message.send.mock.calls[0][0].requestId);
    expect(request.payload.context).toEqual(expect.objectContaining({
      permissionMode: 'auto',
    }));
    emitRuntimeSuccess(request, 'Runtime response from deepseek-v4-pro for the shell.');
    expect(screen.queryByText('Runtime response from deepseek-v4-pro for the shell.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Artifacts' }));

    expect(screen.getByText('No artifacts yet')).toBeInTheDocument();

    expect(screen.queryByRole('tab', { name: 'Memory' })).not.toBeInTheDocument();
    expect(screen.queryByText('No pending candidates.')).not.toBeInTheDocument();
    expect(screen.queryByText('Session note')).not.toBeInTheDocument();
  });

  it('does not reset the center timeline when switching right panel tabs', async () => {
    const session = installMegumiMock();
    renderChatWithRightPanel();

    const textarea = screen.getByLabelText('Message Megumi');
    const sendButton = screen.getByRole('button', { name: 'Send message' });

    fireEvent.change(textarea, { target: { value: 'Keep my timeline' } });
    fireEvent.click(sendButton);
    await waitFor(() => expect(session.message.send).toHaveBeenCalledTimes(1));

    emitRuntimeStarted(latestSessionMessageSendRequest(session));
    emitRuntimeSuccess(latestSessionMessageSendRequest(session), 'Runtime response from deepseek-v4-flash for timeline persistence.');

    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Artifacts' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    expect(screen.queryByRole('tab', { name: 'Context' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Memory' })).not.toBeInTheDocument();

    expect(screen.getByText('Keep my timeline')).toBeInTheDocument();
    expect(screen.queryByText('Runtime response from deepseek-v4-flash for timeline persistence.')).not.toBeInTheDocument();
  });

  it('shows failed runtime chat status without writing an error timeline message', async () => {
    const session = installMegumiMock();
    renderChatWithRightPanel();

    const textarea = screen.getByLabelText('Message Megumi');
    const sendButton = screen.getByRole('button', { name: 'Send message' });

    fireEvent.change(textarea, { target: { value: 'please fail this run' } });
    fireEvent.click(sendButton);
    await waitFor(() => expect(session.message.send).toHaveBeenCalledTimes(1));

    emitRuntimeFailure(latestSessionMessageSendRequest(session), 'Runtime chat failed for "please fail this run".');

    expect(screen.queryByRole('tab', { name: 'Tasks' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Context' })).not.toBeInTheDocument();

    expect(screen.queryByText('Processing failed')).not.toBeInTheDocument();
    expect(screen.queryByText('Needs attention')).not.toBeInTheDocument();
    expect(screen.queryByText('Runtime chat failed for "please fail this run".')).not.toBeInTheDocument();
  });
});
