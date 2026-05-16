// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { RuntimeIpcRequest } from '@megumi/shared/ipc-contracts';
import type { ChatStartPayload } from '@megumi/shared/ipc-schemas';
import { useArtifactStore } from '@megumi/desktop/renderer/entities/artifact';
import { useChatStore } from '@megumi/desktop/renderer/entities/chat/store';
import { useWorkspaceStateStore } from '@megumi/desktop/renderer/entities/workspace-state';
import { ChatTimeline } from '@megumi/desktop/renderer/features/chat';
import { RightWorkspacePanel } from '@megumi/desktop/renderer/shell/RightWorkspacePanel';

let runtimeEventCallback: ((event: RuntimeEvent) => void) | null = null;
let sequence = 1;
type ChatStartRequest = RuntimeIpcRequest<ChatStartPayload, typeof IPC_CHANNELS.chat.start>;

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
    start: vi.fn().mockImplementation((request: ChatStartRequest) => Promise.resolve({
      ok: true,
      data: { requestId: request.requestId },
      meta: {
        requestId: request.requestId,
        channel: IPC_CHANNELS.chat.start,
        handledAt: '2026-05-10T12:00:00.100Z',
      },
    })),
    cancel: vi.fn().mockResolvedValue({
      ok: true,
      data: { cancelled: true },
      meta: {
        requestId: 'ipc-chat-cancel-1',
        channel: IPC_CHANNELS.chat.cancel,
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
      chat,
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

function latestRequest(chat: ReturnType<typeof installMegumiMock>): ChatStartRequest {
  const request = chat.start.mock.calls.at(-1)?.[0] as ChatStartRequest | undefined;

  if (!request) {
    throw new Error('Expected chat.start to have been called.');
  }

  return request;
}

function emitRuntimeSuccess(request: ChatStartRequest, content: string) {
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

function emitRuntimeFailure(request: ChatStartRequest, message: string) {
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
  useArtifactStore.getState().clearArtifacts();
}

function renderChatWithRightPanel() {
  return render(
    <div className="flex h-screen">
      <ChatTimeline />
      <RightWorkspacePanel collapsed={false} onToggleCollapsed={() => undefined} />
    </div>,
  );
}

describe('right workspace panel runtime chat sync', () => {
  beforeEach(() => {
    installMegumiMock();
    resetStores();
  });

  afterEach(() => {
    runtimeEventCallback = null;
  });

  it('shows task, artifact, and memory state from runtime chat stream events', async () => {
    const chat = installMegumiMock();
    renderChatWithRightPanel();

    const modeSelect = screen.getByLabelText('Composer mode');
    const modelSelect = screen.getByLabelText('Model');
    const textarea = screen.getByLabelText('Message Megumi');
    const sendButton = screen.getByRole('button', { name: 'Send message' });

    fireEvent.change(modeSelect, { target: { value: 'agent' } });
    fireEvent.change(modelSelect, { target: { value: 'deepseek-v4-pro' } });
    fireEvent.change(textarea, { target: { value: 'Start with the shell' } });
    fireEvent.click(sendButton);
    await waitFor(() => expect(chat.start).toHaveBeenCalledTimes(1));
    const request = latestRequest(chat);

    fireEvent.click(screen.getByRole('tab', { name: 'Tasks' }));

    expect(screen.getByText('Session tasks')).toBeInTheDocument();
    expect(screen.getByText('Runtime chat request')).toBeInTheDocument();
    expect(screen.getByText('Streaming provider response for "Start with the shell".')).toBeInTheDocument();

    expect(request.requestId).toBe(chat.start.mock.calls[0][0].requestId);
    emitRuntimeSuccess(request, 'Runtime response from deepseek-v4-pro for the shell.');

    fireEvent.click(screen.getByRole('tab', { name: 'Artifacts' }));

    expect(screen.getByText('Runtime response notes')).toBeInTheDocument();
    expect(screen.getByText('report')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Memory' }));

    expect(screen.getByText('Session note')).toBeInTheDocument();
    expect(screen.getByText('Megumi completed "Start with the shell" in agent mode using deepseek-v4-pro.')).toBeInTheDocument();
  });

  it('does not reset the center timeline when switching right panel tabs', async () => {
    const chat = installMegumiMock();
    renderChatWithRightPanel();

    const textarea = screen.getByLabelText('Message Megumi');
    const sendButton = screen.getByRole('button', { name: 'Send message' });

    fireEvent.change(textarea, { target: { value: 'Keep my timeline' } });
    fireEvent.click(sendButton);
    await waitFor(() => expect(chat.start).toHaveBeenCalledTimes(1));

    emitRuntimeSuccess(latestRequest(chat), 'Runtime response from deepseek-v4-flash for timeline persistence.');

    fireEvent.click(screen.getByRole('tab', { name: 'Tasks' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Artifacts' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Memory' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Context' }));

    expect(screen.getByText('Keep my timeline')).toBeInTheDocument();
    expect(screen.getByText('Runtime response from deepseek-v4-flash for timeline persistence.')).toBeInTheDocument();
  });

  it('shows failed runtime chat state in Tasks tab', async () => {
    const chat = installMegumiMock();
    renderChatWithRightPanel();

    const textarea = screen.getByLabelText('Message Megumi');
    const sendButton = screen.getByRole('button', { name: 'Send message' });

    fireEvent.change(textarea, { target: { value: 'please fail this run' } });
    fireEvent.click(sendButton);
    await waitFor(() => expect(chat.start).toHaveBeenCalledTimes(1));

    emitRuntimeFailure(latestRequest(chat), 'Runtime chat failed for "please fail this run".');

    fireEvent.click(screen.getByRole('tab', { name: 'Tasks' }));

    expect(screen.getByText('Runtime chat request')).toBeInTheDocument();
    expect(screen.getAllByText('Failed').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Runtime chat failed for "please fail this run".').length).toBeGreaterThanOrEqual(1);
  });
});
