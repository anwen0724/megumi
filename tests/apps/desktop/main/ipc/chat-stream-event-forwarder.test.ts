// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { ChatStreamEvent } from '@megumi/shared/chat-stream-events';
import { forwardChatStreamEvent } from '@megumi/desktop/main/ipc/chat-stream-event-forwarder';

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createAssistantTextDeltaEvent(
  overrides: Partial<ChatStreamEvent> = {},
): ChatStreamEvent {
  return {
    eventId: 'chat-event-1',
    eventType: 'assistant.text.delta',
    projectId: 'project-1',
    sessionId: 'session-1',
    runId: 'run-1',
    streamId: 'stream-1',
    streamKind: 'main',
    seq: 1,
    createdAt: '2026-05-24T00:00:00.000Z',
    textId: 'text-1',
    phase: 'answer',
    delta: 'Hello',
    ...overrides,
  } as ChatStreamEvent;
}

describe('forwardChatStreamEvent', () => {
  it('validates and sends chat stream events on the chat stream IPC channel', () => {
    const sender = { send: vi.fn() };
    const logger = createLogger();
    const event = createAssistantTextDeltaEvent();

    forwardChatStreamEvent(sender, event, { logger });

    expect(sender.send).toHaveBeenCalledWith(IPC_CHANNELS.chatStream.event, event);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('drops invalid chat stream events and logs event diagnostics', () => {
    const sender = { send: vi.fn() };
    const logger = createLogger();
    const invalidEvent = createAssistantTextDeltaEvent({
      eventId: 'chat-event-invalid',
      streamId: 'run-1',
    });

    forwardChatStreamEvent(sender, invalidEvent, { logger });

    expect(sender.send).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'chat_stream_event_invalid',
      expect.objectContaining({
        eventId: 'chat-event-invalid',
        eventType: 'assistant.text.delta',
        issueCount: expect.any(Number),
      }),
    );
  });

  it('logs send failures without exposing raw error details', () => {
    const sender = {
      send: vi.fn(() => {
        throw new Error('send failed with sk-chat-stream-secret');
      }),
    };
    const logger = createLogger();
    const event = createAssistantTextDeltaEvent();

    forwardChatStreamEvent(sender, event, { logger });

    expect(logger.error).toHaveBeenCalledWith(
      'chat_stream_event_send_failed',
      expect.objectContaining({
        eventId: 'chat-event-1',
        eventType: 'assistant.text.delta',
        message: 'Chat stream event delivery failed.',
      }),
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('sk-chat-stream-secret');
  });
});
