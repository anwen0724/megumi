// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { ChatStreamEvent } from '@megumi/coding-agent/projections/chat-stream';
import { dispatchChatStreamEvent } from '@megumi/desktop/renderer/features/chat-stream/chat-stream-dispatcher';
import {
  chatStreamSessionKey,
  useChatStreamStore,
} from '@megumi/desktop/renderer/features/chat-stream/chat-stream-store';

function event(input: Partial<ChatStreamEvent> & Pick<ChatStreamEvent, 'eventType' | 'seq'>): ChatStreamEvent {
  return {
    eventId: `chat-stream-event-${input.seq}`,
    projectId: 'project-1',
    sessionId: 'session-1',
    runId: 'run-1',
    streamId: 'stream-1',
    streamKind: 'main',
    createdAt: `2026-05-24T00:00:0${input.seq}.000Z`,
    ...input,
  } as ChatStreamEvent;
}

describe('dispatchChatStreamEvent', () => {
  beforeEach(() => {
    useChatStreamStore.getState().reset();
  });

  it('validates and dispatches chat stream events into the project session store', () => {
    dispatchChatStreamEvent(event({
      eventType: 'turn.started',
      seq: 1,
      userMessageId: 'message-user-1',
    }));
    dispatchChatStreamEvent(event({
      eventType: 'user.message.committed',
      seq: 2,
      clientMessageId: 'client-message-1',
      messageId: 'message-user-1',
      text: 'Hello Megumi',
    }));

    const session = useChatStreamStore.getState().sessions[chatStreamSessionKey('project-1', 'session-1')];

    expect(session).toMatchObject({
      projectId: 'project-1',
      sessionId: 'session-1',
      streamsById: {
        'stream-1': expect.objectContaining({
          runId: 'run-1',
          lastSeq: 2,
          status: 'running',
        }),
      },
    });
    expect(session.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
  });

  it('rejects invalid chat stream events before they reach the store', () => {
    dispatchChatStreamEvent(event({
      eventType: 'turn.started',
      seq: 1,
      streamId: 'run-1',
      userMessageId: 'message-user-1',
    }));

    expect(useChatStreamStore.getState().sessions).toEqual({});
  });
});

