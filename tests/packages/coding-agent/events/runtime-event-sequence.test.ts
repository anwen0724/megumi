import { describe, expect, it } from 'vitest';
import {
  RuntimeEventSequenceCursor,
  lastRuntimeEventSequence,
  withRuntimeRequestMetadata,
  type RuntimeEvent,
} from '@megumi/coding-agent/events';

function event(sequence: number): RuntimeEvent {
  return {
    eventId: `event:${sequence}`,
    schemaVersion: 1,
    eventType: 'run.started',
    runId: 'run:1',
    sessionId: 'session:1',
    sequence,
    createdAt: '2026-01-01T00:00:00.000Z',
    source: 'core',
    visibility: 'system',
    persist: 'transient',
    payload: { runId: 'run:1' },
  };
}

describe('runtime event sequence helpers', () => {
  it('assigns sequence numbers when an event has no sequence yet', () => {
    const cursor = new RuntimeEventSequenceCursor(7);

    expect(cursor.normalize(event(0)).sequence).toBe(8);
    expect(cursor.value()).toBe(8);
  });

  it('keeps existing positive sequence numbers', () => {
    const cursor = new RuntimeEventSequenceCursor(7);

    expect(cursor.normalize(event(3)).sequence).toBe(3);
    expect(cursor.value()).toBe(7);
  });

  it('finds the last sequence in a list', () => {
    expect(lastRuntimeEventSequence([event(2), event(9), event(4)])).toBe(9);
  });

  it('adds request metadata without overwriting existing event metadata', () => {
    expect(withRuntimeRequestMetadata(event(1), {
      requestId: 'request:1',
      context: {
        requestId: 'request:1',
        traceId: 'trace-1',
        operationName: 'chat.send',
        source: 'renderer',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    })).toMatchObject({
      requestId: 'request:1',
      context: { traceId: 'trace-1' },
    });
  });
});
