/*
 * Verifies ordered event delivery, unsubscription, and consumer-failure isolation.
 */
import { describe, expect, it } from 'vitest';
import { createRuntimeEventBus, type RuntimeEvent } from '../../../packages/events/src/index';

function event(sequence: number): RuntimeEvent {
  return {
    eventId: `event:${sequence}`, schemaVersion: 1, eventType: 'run.started', runId: 'run:1',
    sessionId: 'session:1', sequence, createdAt: '2026-01-01T00:00:00.000Z', source: 'core',
    visibility: 'system', persist: 'transient', payload: { runId: 'run:1' },
  };
}

describe('RuntimeEventBus', () => {
  it('publishes in order and stops after unsubscribe', async () => {
    const bus = createRuntimeEventBus();
    const received: number[] = [];
    const subscription = bus.subscribe({ handler: ({ sequence }) => { received.push(sequence); } });
    await bus.publish({ event: event(1) });
    subscription.unsubscribe();
    await bus.publish({ event: event(2) });
    expect(received).toEqual([1]);
  });

  it('supports the canonical request-based publisher contract', async () => {
    const bus = createRuntimeEventBus();
    const received: number[] = [];
    bus.subscribe({ handler: ({ sequence }) => { received.push(sequence); } });
    await bus.publish({ event: event(3) });
    expect(received).toEqual([3]);
  });

  it('isolates subscriber failures and reports a safe diagnostic', async () => {
    const diagnostics: unknown[] = [];
    const bus = createRuntimeEventBus({ onConsumerError: (failure) => { diagnostics.push(failure); } });
    const received: string[] = [];
    bus.subscribe({ handler: () => { throw new Error('super-secret provider body'); } });
    bus.subscribe({ handler: (item) => { received.push(item.eventId); } });

    await expect(bus.publish({ event: event(1) })).resolves.toBeUndefined();
    expect(received).toEqual(['event:1']);
    expect(diagnostics).toHaveLength(1);
    expect(JSON.stringify(diagnostics)).not.toContain('super-secret');
    expect(diagnostics[0]).toMatchObject({
      eventId: 'event:1',
      error: { code: 'runtime_unknown', message: 'Runtime event consumer failed.', source: 'core' },
    });
  });
});
