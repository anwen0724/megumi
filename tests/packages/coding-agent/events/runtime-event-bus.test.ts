import { describe, expect, it } from 'vitest';
import { createRuntimeEventBus, type RuntimeEvent } from '@megumi/coding-agent/events';

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

describe('RuntimeEventBus', () => {
  it('publishes events to subscribers in order', async () => {
    const bus = createRuntimeEventBus();
    const received: RuntimeEvent[] = [];
    bus.subscribe((item) => {
      received.push(item);
    });

    await bus.publish(event(1));
    await bus.publish(event(2));

    expect(received.map((item) => item.sequence)).toEqual([1, 2]);
  });

  it('stops sending events after unsubscribe', async () => {
    const bus = createRuntimeEventBus();
    const received: RuntimeEvent[] = [];
    const subscription = bus.subscribe((item) => {
      received.push(item);
    });

    await bus.publish(event(1));
    subscription.unsubscribe();
    await bus.publish(event(2));

    expect(received.map((item) => item.eventId)).toEqual(['event:1']);
  });
});
