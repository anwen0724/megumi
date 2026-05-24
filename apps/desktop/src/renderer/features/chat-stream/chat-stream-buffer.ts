import type { ChatStreamEvent } from '@megumi/shared/chat-stream-events';

export type ChatStreamBufferResult =
  | { status: 'accepted' }
  | { status: 'duplicate' }
  | { status: 'gap'; expectedSeq: number; receivedSeq: number };

export interface ChatStreamBufferOptions {
  applyEvent(event: ChatStreamEvent): void;
  onGap?: (gap: { expectedSeq: number; receivedSeq: number; event: ChatStreamEvent }) => void;
  flushIntervalMs?: number;
  scheduleFlush?: (callback: () => void, delayMs: number) => { cancel(): void };
}

export interface ChatStreamBuffer {
  handle(event: ChatStreamEvent): ChatStreamBufferResult;
  flush(): void;
  dispose(): void;
}

type BufferedDeltaEvent = Extract<
  ChatStreamEvent,
  { eventType: 'assistant.text.delta' | 'assistant.thinking.delta' }
>;

type ScheduledFlush = { cancel(): void };

const DEFAULT_FLUSH_INTERVAL_MS = 100;

const TERMINAL_EVENT_TYPES = new Set<ChatStreamEvent['eventType']>([
  'assistant.text.completed',
  'assistant.text.failed',
  'assistant.text.cancelled_partial',
  'assistant.thinking.completed',
  'turn.completed',
  'turn.failed',
  'turn.cancelled',
]);

export function createChatStreamBuffer(options: ChatStreamBufferOptions): ChatStreamBuffer {
  const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  const pendingDeltas = new Map<string, BufferedDeltaEvent>();
  let lastSeq = 0;
  let flushHandle: ScheduledFlush | null = null;
  let firstGap: { expectedSeq: number; receivedSeq: number } | null = null;

  function defaultScheduleFlush(callback: () => void, delayMs: number): ScheduledFlush {
    const timeoutId = window.setTimeout(callback, delayMs);
    return {
      cancel: () => window.clearTimeout(timeoutId),
    };
  }

  function schedulePendingFlush(): void {
    if (flushHandle) return;
    const scheduler = options.scheduleFlush ?? defaultScheduleFlush;
    flushHandle = scheduler(() => {
      flushHandle = null;
      flush();
    }, flushIntervalMs);
  }

  function mergeDelta(event: BufferedDeltaEvent): void {
    const key = deltaKey(event);
    const existing = pendingDeltas.get(key);

    if (!existing) {
      pendingDeltas.set(key, event);
      return;
    }

    pendingDeltas.set(key, {
      ...event,
      delta: existing.delta + event.delta,
    } as BufferedDeltaEvent);
  }

  function flush(): void {
    if (flushHandle) {
      flushHandle.cancel();
      flushHandle = null;
    }

    const events = [...pendingDeltas.values()].sort((left, right) => left.seq - right.seq);
    pendingDeltas.clear();

    for (const event of events) {
      options.applyEvent(event);
    }
  }

  return {
    handle: (event) => {
      if (firstGap) {
        return { status: 'gap', ...firstGap };
      }

      if (event.seq <= lastSeq) {
        return { status: 'duplicate' };
      }

      const expectedSeq = lastSeq + 1;
      if (event.seq > expectedSeq) {
        const result = { status: 'gap' as const, expectedSeq, receivedSeq: event.seq };
        firstGap = { expectedSeq, receivedSeq: event.seq };
        options.onGap?.({ expectedSeq, receivedSeq: event.seq, event });
        return result;
      }

      lastSeq = event.seq;

      if (isDeltaEvent(event)) {
        mergeDelta(event);
        schedulePendingFlush();
        return { status: 'accepted' };
      }

      if (TERMINAL_EVENT_TYPES.has(event.eventType)) {
        flush();
      }

      options.applyEvent(event);
      return { status: 'accepted' };
    },
    flush,
    dispose: () => {
      if (flushHandle) {
        flushHandle.cancel();
        flushHandle = null;
      }
      pendingDeltas.clear();
    },
  };
}

function isDeltaEvent(event: ChatStreamEvent): event is BufferedDeltaEvent {
  return event.eventType === 'assistant.text.delta' || event.eventType === 'assistant.thinking.delta';
}

function deltaKey(event: BufferedDeltaEvent): string {
  if (event.eventType === 'assistant.text.delta') {
    return `text:${event.textId}:${event.phase}`;
  }

  return `thinking:${event.thinkingId}`;
}
