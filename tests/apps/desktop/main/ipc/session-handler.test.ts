/* Protects the cross-window optimistic message projection owned by Desktop. */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/desktop/main/ipc/channels';
import { registerSessionHandlers } from '@megumi/desktop/main/ipc/handlers/session.handler';
import { SessionMessagePresentationEventSchema } from '@megumi/desktop/main/ipc/session-message-presentation';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

describe('registerSessionHandlers message projection', () => {
  it('rejects malformed cross-window presentation events at the Preload boundary contract', () => {
    expect(SessionMessagePresentationEventSchema.safeParse({
      phase: 'accepted',
      projectId: 'project:1',
      sessionId: 'session:1',
      clientMessageId: 'client-message:1',
      text: '语音输入',
      createdAt: '2026-08-14T00:00:00.000Z',
      // messageId and runId are intentionally missing.
    }).success).toBe(false);
  });

  it('publishes the pending user message before Product settles, then confirms its committed identity', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const handle = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    });
    const submission = deferred<{ payload: ReturnType<typeof agentRunPayload> }>();
    const sendUserInput = vi.fn(() => submission.promise);
    const publishMessageEvent = vi.fn();

    registerSessionHandlers(
      { host: { session: { sendUserInput } } as never },
      { ipcMain: { handle } as never, publishMessageEvent },
    );

    const request = {
      requestId: 'request:voice:1',
      payload: {
        sessionId: 'session:1',
        projectId: 'project:1',
        text: '语音输入',
        clientMessageId: 'client-message:1',
        createdAt: '2026-08-14T00:00:00.000Z',
        modelSelection: { provider_id: 'provider:1', model_id: 'model:1' },
        permissionMode: 'ask',
      },
      meta: {
        channel: IPC_CHANNELS.session.sessionMessageSend,
        createdAt: '2026-08-14T00:00:00.000Z',
        source: 'renderer',
      },
    } as const;

    const responsePromise = handlers.get(IPC_CHANNELS.session.sessionMessageSend)?.({}, request);

    expect(publishMessageEvent).toHaveBeenCalledWith({
      phase: 'pending',
      projectId: 'project:1',
      sessionId: 'session:1',
      clientMessageId: 'client-message:1',
      text: '语音输入',
      createdAt: '2026-08-14T00:00:00.000Z',
    });
    expect(sendUserInput).toHaveBeenCalledOnce();

    submission.resolve({ payload: agentRunPayload() });
    await responsePromise;

    expect(publishMessageEvent).toHaveBeenLastCalledWith({
      phase: 'accepted',
      projectId: 'project:1',
      sessionId: 'session:1',
      clientMessageId: 'client-message:1',
      messageId: 'message:1',
      runId: 'run:1',
      text: '语音输入',
      createdAt: '2026-08-14T00:00:00.000Z',
    });
  });
});

function agentRunPayload() {
  return {
    type: 'agent_run' as const,
    requestId: 'request:voice:1',
    userMessageId: 'message:1',
    session: {
      id: 'session:1',
      projectId: 'project:1',
      title: 'Voice',
      status: 'active' as const,
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
    },
    userMessage: {
      messageId: 'message:1',
      sessionId: 'session:1',
      runId: 'run:1',
      kind: 'user' as const,
      displayContent: [{ type: 'text' as const, text: '语音输入' }],
      attachments: [],
      createdAt: '2026-08-14T00:00:00.000Z',
      completedAt: '2026-08-14T00:00:00.000Z',
    },
    run: {
      runId: 'run:1',
      sessionId: 'session:1',
      status: 'running' as const,
      createdAt: '2026-08-14T00:00:00.000Z',
    },
  };
}
