import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentRuntimeEvent } from '../../../src/app';
import { mapAgentRuntimeEventToChatStreamEvent } from '../../../src/desktop/mappers/agent-runtime-event-to-chat-stream-event.mapper';
import { dispatchChatStreamEvent } from '../../../src/ui/features/chat-stream/chat-stream-dispatcher';
import { chatStreamSessionKey, useChatStreamStore } from '../../../src/ui/features/chat-stream/chat-stream-store';

function agentRuntimeEvent(payload: Record<string, unknown>): AgentRuntimeEvent {
  return {
    type: 'ai.message.event',
    occurredAt: '2026-06-19T00:00:01.000Z',
    runId: 'run-1',
    sessionId: 'session-1',
    workspaceId: 'workspace-1',
    payload: {
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
    const forwarded = mapAgentRuntimeEventToChatStreamEvent(agentRuntimeEvent({
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
