// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionMessage } from '@megumi/shared/session';
import type { RuntimeEvent } from '@megumi/shared/runtime';

const { handle } = vi.hoisted(() => ({
  handle: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: { handle },
}));

function createRequest(channel: string, payload: Record<string, unknown>, requestId = 'ipc-session-message-send-1') {
  return {
    requestId,
    payload,
    meta: {
      channel,
      createdAt: '2026-05-17T00:00:00.000Z',
      source: 'renderer',
    },
    context: {
      requestId,
      traceId: `trace-${requestId}`,
      debugId: `debug-${requestId}`,
      operationName: channel.replace(/:/g, '.'),
      source: 'renderer',
      createdAt: '2026-05-17T00:00:00.000Z',
    },
  };
}

function createSessionMessageSendPayload() {
  return {
    sessionId: 'session-1',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    createdAt: '2026-05-17T00:00:00.000Z',
    messages: [
      {
        id: 'message-1',
        role: 'user',
        content: 'Hello',
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    ],
  };
}

function createSessionServiceMock(overrides: Record<string, unknown> = {}) {
  const flat = {
    createSession: vi.fn(),
    listSessions: vi.fn(),
    listMessagesBySession: vi.fn(),
    listTimelineMessagesBySession: vi.fn(),
    sendInput: vi.fn(),
    cancelSessionMessage: vi.fn(),
    createBranchDraft: vi.fn(),
    cancelBranchDraft: vi.fn(),
    ...overrides,
  };
  return {
    ...flat,
    host: {
      session: {
        create: (payload: unknown) => ({ session: flat.createSession(payload) }),
        list: () => ({ sessions: flat.listSessions() }),
        listMessages: (sessionId: string) => ({ messages: flat.listMessagesBySession(sessionId) }),
        listTimeline: flat.listTimelineMessagesBySession,
        createDraft: flat.createBranchDraft,
        cancelDraft: flat.cancelBranchDraft,
      },
      input: {
        send: flat.sendInput,
        cancel: flat.cancelSessionMessage,
      },
    },
  } as any;
}

describe('registerSessionHandlers', () => {
  beforeEach(() => {
    vi.resetModules();
    handle.mockReset();
  });

  it('registers primary session IPC handlers', async () => {
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc');
    const { registerSessionHandlers } = await import('@megumi/desktop/main/ipc/handlers/session.handler');

    registerSessionHandlers(createSessionServiceMock());

    expect(handle).toHaveBeenCalledWith(IPC_CHANNELS.session.create, expect.any(Function));
    expect(handle).toHaveBeenCalledWith(IPC_CHANNELS.session.list, expect.any(Function));
    expect(handle).toHaveBeenCalledWith(IPC_CHANNELS.session.message.list, expect.any(Function));
    expect(handle).toHaveBeenCalledWith(IPC_CHANNELS.session.message.send, expect.any(Function));
    expect(handle).toHaveBeenCalledWith(IPC_CHANNELS.session.message.cancel, expect.any(Function));
    expect(handle).toHaveBeenCalledWith(IPC_CHANNELS.session.branchDraft.create, expect.any(Function));
    expect(handle).toHaveBeenCalledWith(IPC_CHANNELS.session.branchDraft.cancel, expect.any(Function));
  });

  it('returns persisted messages for a session', async () => {
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc');
    const { registerSessionHandlers } = await import('@megumi/desktop/main/ipc/handlers/session.handler');
    const messages: SessionMessage[] = [
      {
        messageId: 'message-1',
        sessionId: 'session-1',
        role: 'user',
        content: 'Hello',
        status: 'completed',
        createdAt: '2026-05-17T00:00:00.000Z',
        completedAt: '2026-05-17T00:00:00.000Z',
      },
    ];
    const service = createSessionServiceMock({
      listMessagesBySession: vi.fn(() => messages),
    });

    registerSessionHandlers(service);

    const handler = handle.mock.calls.find(([channel]) => channel === IPC_CHANNELS.session.message.list)?.[1];
    await expect(handler({}, {
      requestId: 'ipc-session-message-list-1',
      payload: { sessionId: 'session-1' },
      meta: {
        channel: IPC_CHANNELS.session.message.list,
        createdAt: '2026-05-17T00:00:00.000Z',
        source: 'renderer',
      },
    })).resolves.toMatchObject({
      ok: true,
      data: { messages },
      meta: {
        requestId: 'ipc-session-message-list-1',
        channel: IPC_CHANNELS.session.message.list,
      },
    });
    expect(service.listMessagesBySession).toHaveBeenCalledWith('session-1');
  });

  it('registers a timeline history list handler returning canonical TimelineMessage records', async () => {
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc');
    const { registerSessionHandlers } = await import('@megumi/desktop/main/ipc/handlers/session.handler');
    const service = createSessionServiceMock({
      listTimelineMessagesBySession: vi.fn(() => ({
        messages: [{
          messageId: 'assistant:run-1',
          role: 'assistant',
          projectId: 'project-1',
          sessionId: 'session-1',
          runId: 'run-1',
          createdAt: '2026-05-24T00:00:00.000Z',
          blocks: [{
            blockId: 'process:run-1',
            kind: 'process_disclosure',
            runId: 'run-1',
            status: 'completed',
            items: [],
          }],
        }],
        diagnostics: [],
      })),
    });

    registerSessionHandlers(service);

    const handler = handle.mock.calls.find(([channel]) => channel === IPC_CHANNELS.session.timeline.list)?.[1];
    const result = await handler({}, createRequest(
      IPC_CHANNELS.session.timeline.list,
      { projectId: 'project-1', sessionId: 'session-1' },
      'ipc-session-timeline-list-1',
    ));

    expect(result.ok).toBe(true);
    expect(result.data.messages).toHaveLength(1);
    expect(service.listTimelineMessagesBySession).toHaveBeenCalledWith({
      projectId: 'project-1',
      sessionId: 'session-1',
    });
  });

  it('sends session messages and forwards runtime events', async () => {
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc');
    const { registerSessionHandlers } = await import('@megumi/desktop/main/ipc/handlers/session.handler');
    const eventSender = { send: vi.fn() };
    const runtimeEvent = {
      eventId: 'event-1',
      schemaVersion: 1,
      eventType: 'assistant.output.delta',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      sequence: 1,
      createdAt: '2026-05-17T00:00:01.000Z',
      source: 'provider',
      visibility: 'user',
      persist: 'transient',
      payload: { delta: 'Hello' },
    } satisfies RuntimeEvent;
    const service = createSessionServiceMock({
      sendInput: vi.fn(async () => ({
        type: 'agent_run',
        requestId: 'ipc-session-message-send-1',
        session: {
          sessionId: 'session-1',
          title: 'Hello',
          workspaceId: 'project-1',
          workspacePath: 'C:/all/work/study/megumi',
          createdAt: '2026-05-17T00:00:00.000Z',
          updatedAt: '2026-05-17T00:00:00.000Z',
          status: 'active',
        },
        userMessageId: 'message-1',
        runId: 'run-1',
        events: async function* () {
          yield runtimeEvent;
        }(),
      })),
    });

    registerSessionHandlers(service);

    const handler = handle.mock.calls.find(([channel]) => channel === IPC_CHANNELS.session.message.send)?.[1];
    await expect(handler({ sender: eventSender }, createRequest(
      IPC_CHANNELS.session.message.send,
      createSessionMessageSendPayload(),
    ))).resolves.toMatchObject({
      ok: true,
      data: {
        requestId: 'ipc-session-message-send-1',
        session: {
          sessionId: 'session-1',
          title: 'Hello',
          workspaceId: 'project-1',
          workspacePath: 'C:/all/work/study/megumi',
        },
        userMessageId: 'message-1',
        runId: 'run-1',
      },
      meta: {
        requestId: 'ipc-session-message-send-1',
        channel: IPC_CHANNELS.session.message.send,
      },
    });

    await vi.waitFor(() => {
      expect(eventSender.send).toHaveBeenCalledWith(IPC_CHANNELS.runtime.event, runtimeEvent);
    });
    expect(service.sendInput).toHaveBeenCalledWith({
      requestId: 'ipc-session-message-send-1',
      sessionId: 'session-1',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      text: 'Hello',
      clientMessageId: 'message-1',
      createdAt: '2026-05-17T00:00:00.000Z',
      runtimeContext: expect.objectContaining({
        requestId: 'ipc-session-message-send-1',
        operationName: 'session.message.send',
      }),
    });
  });

  it('creates and cancels branch drafts through session IPC', async () => {
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc');
    const { registerSessionHandlers } = await import('@megumi/desktop/main/ipc/handlers/session.handler');
    const eventSender = { send: vi.fn() };
    const service = createSessionServiceMock({
      createBranchDraft: vi.fn(() => ({
        branchDraft: {
          branchMarkerId: 'branch-marker-1',
          sessionId: 'session-1',
          sourceMessageId: 'message-1',
          seedText: 'original prompt',
          label: 'Branch from 07:28',
          intent: 'branch',
          createdAt: '2026-06-01T10:00:00.000Z',
        },
        events: [],
      })),
      cancelBranchDraft: vi.fn(() => ({
        cancelled: true,
        events: [],
      })),
    });

    registerSessionHandlers(service);

    const createHandler = handle.mock.calls.find(
      ([channel]) => channel === IPC_CHANNELS.session.branchDraft.create,
    )?.[1];
    const createResult = await createHandler({ sender: eventSender }, {
      requestId: 'request-branch-1',
      payload: {
        sessionId: 'session-1',
        messageId: 'message-1',
        intent: 'branch',
        createdAt: '2026-06-01T10:00:00.000Z',
      },
      meta: {
        channel: IPC_CHANNELS.session.branchDraft.create,
        createdAt: '2026-06-01T10:00:00.000Z',
        source: 'renderer',
      },
    });
    expect(createResult.ok).toBe(true);
    expect(createResult.data.branchDraft.seedText).toBe('original prompt');

    const cancelHandler = handle.mock.calls.find(
      ([channel]) => channel === IPC_CHANNELS.session.branchDraft.cancel,
    )?.[1];
    const cancelResult = await cancelHandler({ sender: eventSender }, {
      requestId: 'request-branch-cancel-1',
      payload: {
        sessionId: 'session-1',
        branchMarkerId: 'branch-marker-1',
        createdAt: '2026-06-01T10:00:01.000Z',
      },
      meta: {
        channel: IPC_CHANNELS.session.branchDraft.cancel,
        createdAt: '2026-06-01T10:00:01.000Z',
        source: 'renderer',
      },
    });
    expect(cancelResult.ok).toBe(true);
    expect(cancelResult.data.cancelled).toBe(true);
  });
});
