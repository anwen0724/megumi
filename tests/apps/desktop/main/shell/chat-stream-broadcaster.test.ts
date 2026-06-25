// @vitest-environment node
// Verifies the chat-stream broadcaster forwards product chat stream events to the
// current BrowserWindow's webContents, and is a no-op when no window is attached or
// the window has been destroyed.
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/shared/ipc';
import { createChatStreamBroadcaster } from '@megumi/desktop/main/shell/chat-stream-broadcaster';
import type { ChatStreamEvent } from '@megumi/shared/chat-stream';

function chatStreamEvent(): ChatStreamEvent {
  return {
    eventId: 'event-1',
    eventType: 'turn.completed',
    streamKind: 'main',
    streamId: 'stream-1',
    projectId: 'project-1',
    sessionId: 'session-1',
    runId: 'run-1',
    seq: 1,
    createdAt: '2026-06-24T00:00:00.000Z',
  } as ChatStreamEvent;
}

function fakeWindow() {
  const send = vi.fn();
  return {
    isDestroyed: () => false,
    webContents: { send },
    _send: send,
  };
}

describe('chat stream broadcaster', () => {
  it('forwards events to the attached window webContents', () => {
    const broadcaster = createChatStreamBroadcaster();
    const window = fakeWindow();
    broadcaster.setWindow(window as never);

    broadcaster.publish(chatStreamEvent());

    expect(window._send).toHaveBeenCalledWith(IPC_CHANNELS.chatStream.event, expect.objectContaining({
      eventType: 'turn.completed',
    }));
  });

  it('is a no-op when no window is attached', () => {
    const broadcaster = createChatStreamBroadcaster();
    expect(() => broadcaster.publish(chatStreamEvent())).not.toThrow();
  });

  it('is a no-op after the window is cleared', () => {
    const broadcaster = createChatStreamBroadcaster();
    const window = fakeWindow();
    broadcaster.setWindow(window as never);
    broadcaster.setWindow(undefined);

    broadcaster.publish(chatStreamEvent());

    expect(window._send).not.toHaveBeenCalled();
  });

  it('is a no-op when the attached window has been destroyed', () => {
    const broadcaster = createChatStreamBroadcaster();
    const send = vi.fn();
    broadcaster.setWindow({ isDestroyed: () => true, webContents: { send } } as never);

    broadcaster.publish(chatStreamEvent());

    expect(send).not.toHaveBeenCalled();
  });
});
