import { describe, expect, it, vi } from 'vitest';

import { RuntimeEventLog } from '@megumi/coding-agent/events';
import type { RuntimeEvent } from '@megumi/shared/runtime';

describe('RuntimeEventLog', () => {
  it('normalizes request metadata, advances run sequence, appends, and fans out events', () => {
    const repository = new InMemoryRuntimeEventStore([
      runtimeEvent({ eventId: 'event-1', sequence: 3 }),
    ]);
    const log = new RuntimeEventLog(repository);
    const sink = {
      handleRuntimeEvent: vi.fn(),
      dispose: vi.fn(),
    };
    const onTerminalEvent = vi.fn();

    const appended = log.appendWithRuntimeRequest(
      runtimeEvent({
        eventId: 'event-2',
        eventType: 'run.completed',
        sequence: 1,
      }),
      {
        requestId: 'request-1',
        runtimeContext: {
          requestId: 'request-1',
          traceId: 'trace-1',
          operationName: 'session.message.send',
          source: 'main',
          createdAt: '2026-06-29T00:00:00.000Z',
        },
      },
      { streamSink: sink, onTerminalEvent },
    );

    expect(appended).toMatchObject({
      eventId: 'event-2',
      sequence: 4,
      requestId: 'request-1',
      context: { traceId: 'trace-1' },
    });
    expect(repository.listRuntimeEventsByRun('run-1').map((event) => event.sequence)).toEqual([3, 4]);
    expect(sink.handleRuntimeEvent).toHaveBeenCalledWith(appended);
    expect(onTerminalEvent).toHaveBeenCalledWith(appended);
    expect(sink.dispose).toHaveBeenCalledTimes(1);
  });

  it('creates sequence cursors from the latest persisted run event', () => {
    const log = new RuntimeEventLog(new InMemoryRuntimeEventStore([
      runtimeEvent({ eventId: 'event-1', sequence: 2 }),
      runtimeEvent({ eventId: 'event-2', sequence: 7 }),
    ]));

    const cursor = log.createSequenceCursor({ runId: 'run-1', startSequence: 4 });

    expect(cursor.value()).toBe(7);
    expect(cursor.next()).toBe(8);
  });
});

class InMemoryRuntimeEventStore {
  constructor(private readonly events: RuntimeEvent[] = []) {}

  appendRuntimeEvent(event: RuntimeEvent): RuntimeEvent {
    this.events.push(event);
    return event;
  }

  listRuntimeEventsByRun(runId: string): RuntimeEvent[] {
    return this.events
      .filter((event) => event.runId === runId)
      .sort((left, right) => left.sequence - right.sequence);
  }
}

function runtimeEvent(input: Partial<RuntimeEvent> & {
  eventId: string;
  sequence: number;
}): RuntimeEvent {
  return {
    eventId: input.eventId,
    schemaVersion: 1,
    eventType: input.eventType ?? 'run.started',
    runId: input.runId ?? 'run-1',
    sessionId: input.sessionId ?? 'session-1',
    sequence: input.sequence,
    createdAt: input.createdAt ?? '2026-06-29T00:00:00.000Z',
    source: input.source ?? 'core',
    visibility: input.visibility ?? 'user',
    persist: input.persist ?? 'required',
    payload: input.payload ?? {},
  };
}
