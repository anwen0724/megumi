/*
 * Runtime event sequencing helpers. The bus is in-memory, but event consumers still need
 * deterministic per-run ordering and request correlation.
 */
import type { RuntimeEvent } from '../contracts/runtime-event-contracts';

export type RuntimeEventRequestMetadata = {
  requestId?: string;
  context?: RuntimeEvent['context'];
};

export class RuntimeEventSequenceCursor {
  private current: number;

  constructor(startSequence = 0) {
    this.current = startSequence;
  }

  next(): number {
    this.current += 1;
    return this.current;
  }

  normalize<TEvent extends RuntimeEvent>(event: TEvent): TEvent {
    return {
      ...event,
      sequence: event.sequence > 0 ? event.sequence : this.next(),
    };
  }

  value(): number {
    return this.current;
  }
}

export function lastRuntimeEventSequence(events: readonly RuntimeEvent[]): number {
  return events.reduce((max, event) => Math.max(max, event.sequence), 0);
}

export function nextRuntimeEventSequence(events: readonly RuntimeEvent[]): number {
  return lastRuntimeEventSequence(events) + 1;
}

export function withSequenceAfter<TEvent extends RuntimeEvent>(
  event: TEvent,
  lastSequence: number,
): TEvent {
  return {
    ...event,
    sequence: event.sequence > 0 ? event.sequence : lastSequence + 1,
  };
}

export function withRuntimeRequestMetadata<TEvent extends RuntimeEvent>(
  event: TEvent,
  request: RuntimeEventRequestMetadata,
): TEvent {
  return {
    ...event,
    requestId: event.requestId ?? request.requestId,
    context: event.context ?? request.context,
  };
}
