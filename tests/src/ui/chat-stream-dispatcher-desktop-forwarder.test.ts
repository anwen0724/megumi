import { beforeEach, describe, expect, it } from 'vitest';
import type { AppEvent } from '../../../src/app';
import { mapAppEventToChatStreamEvent } from '../../../src/desktop/mappers/app-event-to-chat-stream-event.mapper';
import { dispatchChatStreamEvent } from '../../../src/ui/features/chat-stream/chat-stream-dispatcher';
import { chatStreamSessionKey, useChatStreamStore } from '../../../src/ui/features/chat-stream/chat-stream-store';

function appEvent(payload: Record<string, unknown>): AppEvent {
  return {
    type: 'ai.message.event',
    occurredAt: '2026-06-19T00:00:01.000Z',
    source: 'agent',
    payload: {
      runId: 'run-1',
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      seq: 1,
      ...payload,
    },
  };
}

describe('src/ui chat stream dispatcher desktop projection compatibility', () => {
  beforeEach(() => {
    useChatStreamStore.getState().reset();
  });

  it('dispatches desktop-forwarded renderer chat stream events instead of dropping them', () => {
    const forwarded = mapAppEventToChatStreamEvent(appEvent({
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'hello from desktop' },
      },
    }));

    expect(forwarded).toEqual(expect.objectContaining({ eventType: 'assistant.text.delta' }));

    dispatchChatStreamEvent(forwarded);
    useChatStreamStore.getState().flushStream('workspace-1', 'session-1', 'chat-stream:run-1');

    const session = useChatStreamStore.getState().sessions[chatStreamSessionKey('workspace-1', 'session-1')];
    expect(JSON.stringify(session.messages)).toContain('hello from desktop');
  });
});
