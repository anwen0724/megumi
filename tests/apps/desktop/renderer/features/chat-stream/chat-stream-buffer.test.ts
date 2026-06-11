// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatStreamEvent } from '@megumi/shared/chat-stream';
import { createChatStreamBuffer } from '@megumi/desktop/renderer/features/chat-stream/chat-stream-buffer';

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

describe('chat stream buffer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('batches text and thinking deltas until flush interval and merges same textId/thinkingId deltas', () => {
    const applied: ChatStreamEvent[] = [];
    const buffer = createChatStreamBuffer({
      applyEvent: (item) => applied.push(item),
      flushIntervalMs: 100,
    });

    buffer.handle(event({ eventType: 'assistant.text.delta', seq: 1, textId: 'text-1', phase: 'answer', delta: 'Hel' }));
    buffer.handle(event({ eventType: 'assistant.text.delta', seq: 2, textId: 'text-1', phase: 'answer', delta: 'lo' }));
    buffer.handle(event({ eventType: 'assistant.thinking.delta', seq: 3, thinkingId: 'thinking-1', delta: 'Thin' }));
    buffer.handle(event({ eventType: 'assistant.thinking.delta', seq: 4, thinkingId: 'thinking-1', delta: 'k' }));

    expect(applied).toEqual([]);

    vi.advanceTimersByTime(100);

    expect(applied).toEqual([
      expect.objectContaining({
        eventType: 'assistant.text.delta',
        eventId: 'chat-stream-event-2',
        seq: 2,
        createdAt: '2026-05-24T00:00:02.000Z',
        textId: 'text-1',
        delta: 'Hello',
      }),
      expect.objectContaining({
        eventType: 'assistant.thinking.delta',
        eventId: 'chat-stream-event-4',
        seq: 4,
        createdAt: '2026-05-24T00:00:04.000Z',
        thinkingId: 'thinking-1',
        delta: 'Think',
      }),
    ]);
  });

  it('flushes merged delta keys sorted by latest event seq', () => {
    const applied: ChatStreamEvent[] = [];
    const buffer = createChatStreamBuffer({
      applyEvent: (item) => applied.push(item),
      flushIntervalMs: 100,
    });

    buffer.handle(event({ eventType: 'assistant.text.delta', seq: 1, textId: 'text-a', phase: 'answer', delta: 'Hel' }));
    buffer.handle(event({ eventType: 'assistant.thinking.delta', seq: 2, thinkingId: 'thinking-b', delta: 'Think' }));
    buffer.handle(event({ eventType: 'assistant.text.delta', seq: 3, textId: 'text-a', phase: 'answer', delta: 'lo' }));

    vi.advanceTimersByTime(100);

    expect(applied.map((item) => item.seq)).toEqual([2, 3]);
    expect(applied).toEqual([
      expect.objectContaining({
        eventType: 'assistant.thinking.delta',
        thinkingId: 'thinking-b',
        delta: 'Think',
      }),
      expect.objectContaining({
        eventType: 'assistant.text.delta',
        textId: 'text-a',
        delta: 'Hello',
      }),
    ]);
  });

  it('flushes pending deltas before terminal events', () => {
    const applied: ChatStreamEvent[] = [];
    const buffer = createChatStreamBuffer({
      applyEvent: (item) => applied.push(item),
      flushIntervalMs: 100,
    });

    buffer.handle(event({ eventType: 'assistant.text.delta', seq: 1, textId: 'text-1', phase: 'answer', delta: 'Partial' }));
    buffer.handle(event({ eventType: 'assistant.text.completed', seq: 2, textId: 'text-1', phase: 'answer' }));

    expect(applied.map((item) => item.eventType)).toEqual([
      'assistant.text.delta',
      'assistant.text.completed',
    ]);
    expect(applied[0]).toMatchObject({ delta: 'Partial' });
  });

  it('flushes pending deltas before text reclassification events', () => {
    const applied: ChatStreamEvent[] = [];
    const buffer = createChatStreamBuffer({
      applyEvent: (item) => applied.push(item),
      flushIntervalMs: 100,
    });

    buffer.handle(event({ eventType: 'assistant.text.delta', seq: 1, textId: 'text-1', phase: 'answer', delta: 'Let me check.' }));
    buffer.handle(event({
      eventType: 'assistant.text.reclassified',
      seq: 2,
      textId: 'text-1',
      fromPhase: 'answer',
      toPhase: 'prelude',
    }));

    expect(applied.map((item) => item.eventType)).toEqual([
      'assistant.text.delta',
      'assistant.text.reclassified',
    ]);
  });

  it('returns duplicate for duplicate seq and gap for out-of-order seq without projecting the gap event', () => {
    const applied: ChatStreamEvent[] = [];
    const gaps: Array<{ expectedSeq: number; receivedSeq: number; event: ChatStreamEvent }> = [];
    const buffer = createChatStreamBuffer({
      applyEvent: (item) => applied.push(item),
      flushIntervalMs: 100,
      onGap: (gap) => gaps.push(gap),
    });

    const first = buffer.handle(event({ eventType: 'turn.started', seq: 1, userMessageId: 'message-user-1' }));
    const duplicate = buffer.handle(event({ eventType: 'turn.started', seq: 1, userMessageId: 'message-user-1' }));
    const gap = buffer.handle(event({ eventType: 'turn.completed', seq: 4 }));

    expect(first.status).toBe('accepted');
    expect(duplicate.status).toBe('duplicate');
    expect(gap).toEqual({
      status: 'gap',
      expectedSeq: 2,
      receivedSeq: 4,
    });
    expect(gaps).toEqual([
      expect.objectContaining({
        expectedSeq: 2,
        receivedSeq: 4,
        event: expect.objectContaining({ eventType: 'turn.completed', seq: 4 }),
      }),
    ]);
    expect(applied.map((item) => item.seq)).toEqual([1]);
  });

  it('keeps the first gap as an isolation boundary until replay', () => {
    const applied: ChatStreamEvent[] = [];
    const gaps: Array<{ expectedSeq: number; receivedSeq: number; event: ChatStreamEvent }> = [];
    const buffer = createChatStreamBuffer({
      applyEvent: (item) => applied.push(item),
      flushIntervalMs: 100,
      onGap: (gap) => gaps.push(gap),
    });

    const first = buffer.handle(event({ eventType: 'turn.started', seq: 1, userMessageId: 'message-user-1' }));
    const gap = buffer.handle(event({ eventType: 'turn.completed', seq: 3 }));
    const lateMissing = buffer.handle(event({
      eventType: 'user.message.committed',
      seq: 2,
      clientMessageId: 'client-message-1',
      messageId: 'message-user-1',
      text: 'Hello',
    }));

    expect(first.status).toBe('accepted');
    expect(gap).toEqual({
      status: 'gap',
      expectedSeq: 2,
      receivedSeq: 3,
    });
    expect(lateMissing).toEqual({
      status: 'gap',
      expectedSeq: 2,
      receivedSeq: 3,
    });
    expect(applied.map((item) => item.seq)).toEqual([1]);
    expect(gaps).toEqual([
      expect.objectContaining({
        expectedSeq: 2,
        receivedSeq: 3,
        event: expect.objectContaining({ eventType: 'turn.completed', seq: 3 }),
      }),
    ]);
  });

  it('disposes pending buffered work without applying it later', () => {
    const applied: ChatStreamEvent[] = [];
    const buffer = createChatStreamBuffer({
      applyEvent: (item) => applied.push(item),
      flushIntervalMs: 100,
    });

    buffer.handle(event({ eventType: 'assistant.text.delta', seq: 1, textId: 'text-1', phase: 'answer', delta: 'Stale' }));

    buffer.dispose();
    vi.advanceTimersByTime(100);

    expect(applied).toEqual([]);
  });
});

