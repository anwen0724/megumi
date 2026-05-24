// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatStreamEvent } from '@megumi/shared/chat-stream-events';
import {
  chatStreamSessionKey,
  useChatStreamStore,
} from '@megumi/desktop/renderer/features/chat-stream/chat-stream-store';

function event(input: Partial<ChatStreamEvent> & Pick<ChatStreamEvent, 'eventType' | 'sessionId' | 'streamId' | 'seq'>): ChatStreamEvent {
  return {
    eventId: `${input.streamId}-${input.seq}`,
    projectId: 'project-1',
    runId: 'run-1',
    streamKind: 'main',
    createdAt: `2026-05-24T00:00:0${input.seq}.000Z`,
    ...input,
  } as ChatStreamEvent;
}

describe('chat stream store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useChatStreamStore.getState().reset();
  });

  it('writes events to the owning session, not the active session', () => {
    useChatStreamStore.getState().setActiveSession('project-visible', 'session-visible');

    useChatStreamStore.getState().dispatch(event({
      eventType: 'turn.started',
      sessionId: 'session-owner',
      streamId: 'stream-owner',
      seq: 1,
      userMessageId: 'message-user-1',
    }));
    useChatStreamStore.getState().dispatch(event({
      eventType: 'user.message.committed',
      sessionId: 'session-owner',
      streamId: 'stream-owner',
      seq: 2,
      clientMessageId: 'client-message-1',
      messageId: 'message-user-1',
      text: 'Hello',
    }));

    expect(useChatStreamStore.getState().sessions['session-visible']).toBeUndefined();
    expect(useChatStreamStore.getState().sessions[chatStreamSessionKey('project-1', 'session-owner')].messages).toHaveLength(2);
  });

  it('isolates same session and stream ids across projects without using active session', () => {
    useChatStreamStore.getState().setActiveSession('project-visible', 'session-visible');

    useChatStreamStore.getState().dispatch(event({
      eventType: 'turn.started',
      projectId: 'project-1',
      sessionId: 'session-shared',
      streamId: 'stream-shared',
      seq: 1,
      runId: 'run-project-1',
      userMessageId: 'message-user-project-1',
    }));
    useChatStreamStore.getState().dispatch(event({
      eventType: 'turn.started',
      projectId: 'project-2',
      sessionId: 'session-shared',
      streamId: 'stream-shared',
      seq: 1,
      runId: 'run-project-2',
      userMessageId: 'message-user-project-2',
    }));

    const state = useChatStreamStore.getState();

    expect(state.sessions['session-visible']).toBeUndefined();
    expect(state.sessions['session-shared']).toBeUndefined();
    expect(Object.keys(state.sessions).sort()).toEqual([
      chatStreamSessionKey('project-1', 'session-shared'),
      chatStreamSessionKey('project-2', 'session-shared'),
    ]);
    expect(state.sessions[chatStreamSessionKey('project-1', 'session-shared')]).toMatchObject({
      projectId: 'project-1',
      sessionId: 'session-shared',
      messages: [
        expect.objectContaining({
          messageId: 'assistant:run-project-1',
          runId: 'run-project-1',
        }),
      ],
      streamsById: {
        'stream-shared': expect.objectContaining({
          runId: 'run-project-1',
          lastSeq: 1,
        }),
      },
    });
    expect(state.sessions[chatStreamSessionKey('project-2', 'session-shared')]).toMatchObject({
      projectId: 'project-2',
      sessionId: 'session-shared',
      messages: [
        expect.objectContaining({
          messageId: 'assistant:run-project-2',
          runId: 'run-project-2',
        }),
      ],
      streamsById: {
        'stream-shared': expect.objectContaining({
          runId: 'run-project-2',
          lastSeq: 1,
        }),
      },
    });
  });

  it('marks the correct stream needs_replay on seq gap while lastSeq stays at the last contiguous seq', () => {
    useChatStreamStore.getState().dispatch(event({
      eventType: 'turn.started',
      sessionId: 'session-1',
      streamId: 'stream-1',
      seq: 1,
      userMessageId: 'message-user-1',
    }));
    useChatStreamStore.getState().dispatch(event({
      eventType: 'turn.completed',
      sessionId: 'session-1',
      streamId: 'stream-1',
      seq: 3,
    }));

    expect(useChatStreamStore.getState().sessions[chatStreamSessionKey('project-1', 'session-1')].streamsById['stream-1']).toMatchObject({
      status: 'needs_replay',
      needsReplay: true,
      lastSeq: 1,
      gap: { expectedSeq: 2, receivedSeq: 3 },
    });
    expect(useChatStreamStore.getState().sessions[chatStreamSessionKey('project-1', 'session-1')].messages).toHaveLength(1);
  });

  it('keeps the first stream gap stable and ignores late missing events before replay', () => {
    useChatStreamStore.getState().dispatch(event({
      eventType: 'turn.started',
      sessionId: 'session-1',
      streamId: 'stream-1',
      seq: 1,
      userMessageId: 'message-user-1',
    }));
    useChatStreamStore.getState().dispatch(event({
      eventType: 'turn.completed',
      sessionId: 'session-1',
      streamId: 'stream-1',
      seq: 3,
    }));
    useChatStreamStore.getState().dispatch(event({
      eventType: 'user.message.committed',
      sessionId: 'session-1',
      streamId: 'stream-1',
      seq: 2,
      clientMessageId: 'client-message-1',
      messageId: 'message-user-1',
      text: 'Hello',
    }));

    const session = useChatStreamStore.getState().sessions[chatStreamSessionKey('project-1', 'session-1')];

    expect(session.streamsById['stream-1']).toMatchObject({
      status: 'needs_replay',
      needsReplay: true,
      lastSeq: 1,
      gap: { expectedSeq: 2, receivedSeq: 3 },
    });
    expect(session.messages).toHaveLength(1);
    expect(JSON.stringify(session.messages)).not.toContain('Hello');
  });

  it('sets active project and session ids through the project-aware active session API', () => {
    useChatStreamStore.getState().setActiveSession('project-1', 'session-1');

    expect(useChatStreamStore.getState()).toMatchObject({
      activeProjectId: 'project-1',
      activeSessionId: 'session-1',
      activeSessionKey: chatStreamSessionKey('project-1', 'session-1'),
    });
  });

  it('clears all active session fields through the project-aware active session API', () => {
    useChatStreamStore.getState().setActiveSession('project-1', 'session-1');

    useChatStreamStore.getState().setActiveSession(null, null);

    expect(useChatStreamStore.getState()).toMatchObject({
      activeProjectId: null,
      activeSessionId: null,
      activeSessionKey: null,
    });
  });

  it('does not expose a project-less active session setter', () => {
    expect(useChatStreamStore.getState()).not.toHaveProperty('setActiveSessionId');
  });

  it('treats partial active session input as a full clear', () => {
    useChatStreamStore.getState().setActiveSession('project-1', 'session-1');

    useChatStreamStore.getState().setActiveSession('project-2', null);

    expect(useChatStreamStore.getState()).toMatchObject({
      activeProjectId: null,
      activeSessionId: null,
      activeSessionKey: null,
    });

    useChatStreamStore.getState().setActiveSession(null, 'session-2');

    expect(useChatStreamStore.getState()).toMatchObject({
      activeProjectId: null,
      activeSessionId: null,
      activeSessionKey: null,
    });
  });

  it('flushes delta batches into canonical timeline messages after 100ms', () => {
    useChatStreamStore.getState().dispatch(event({
      eventType: 'turn.started',
      sessionId: 'session-1',
      streamId: 'stream-1',
      seq: 1,
      userMessageId: 'message-user-1',
    }));
    useChatStreamStore.getState().dispatch(event({
      eventType: 'assistant.text.started',
      sessionId: 'session-1',
      streamId: 'stream-1',
      seq: 2,
      textId: 'text-1',
      phase: 'answer',
    }));
    useChatStreamStore.getState().dispatch(event({
      eventType: 'assistant.text.delta',
      sessionId: 'session-1',
      streamId: 'stream-1',
      seq: 3,
      textId: 'text-1',
      phase: 'answer',
      delta: 'Hello',
    }));

    expect(JSON.stringify(useChatStreamStore.getState().sessions[chatStreamSessionKey('project-1', 'session-1')].messages)).not.toContain('Hello');

    vi.advanceTimersByTime(100);

    expect(JSON.stringify(useChatStreamStore.getState().sessions[chatStreamSessionKey('project-1', 'session-1')].messages)).toContain('Hello');
  });

  it('flushes a pending stream immediately when requested before the timer fires', () => {
    useChatStreamStore.getState().dispatch(event({
      eventType: 'turn.started',
      sessionId: 'session-1',
      streamId: 'stream-1',
      seq: 1,
      userMessageId: 'message-user-1',
    }));
    useChatStreamStore.getState().dispatch(event({
      eventType: 'assistant.text.started',
      sessionId: 'session-1',
      streamId: 'stream-1',
      seq: 2,
      textId: 'text-1',
      phase: 'answer',
    }));
    useChatStreamStore.getState().dispatch(event({
      eventType: 'assistant.text.delta',
      sessionId: 'session-1',
      streamId: 'stream-1',
      seq: 3,
      textId: 'text-1',
      phase: 'answer',
      delta: 'Immediate',
    }));

    useChatStreamStore.getState().flushStream('project-1', 'session-1', 'stream-1');

    expect(JSON.stringify(useChatStreamStore.getState().sessions[chatStreamSessionKey('project-1', 'session-1')].messages)).toContain('Immediate');
  });

  it('reset clears pending buffered work so timers do not re-add messages', () => {
    useChatStreamStore.getState().dispatch(event({
      eventType: 'turn.started',
      sessionId: 'session-1',
      streamId: 'stream-1',
      seq: 1,
      userMessageId: 'message-user-1',
    }));
    useChatStreamStore.getState().dispatch(event({
      eventType: 'assistant.text.started',
      sessionId: 'session-1',
      streamId: 'stream-1',
      seq: 2,
      textId: 'text-1',
      phase: 'answer',
    }));
    useChatStreamStore.getState().dispatch(event({
      eventType: 'assistant.text.delta',
      sessionId: 'session-1',
      streamId: 'stream-1',
      seq: 3,
      textId: 'text-1',
      phase: 'answer',
      delta: 'Stale',
    }));

    useChatStreamStore.getState().reset();
    vi.advanceTimersByTime(100);

    expect(useChatStreamStore.getState().sessions).toEqual({});
  });
});
