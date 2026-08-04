/*
 * Verifies the bus contract at its public seam:
 *  - publish fills protocol fields (id, sequence, createdAt)
 *  - sequence is session-monotonic across producers (broadcast's entry fee)
 *  - subscribe filters by sessionId / runId / eventTypes
 *  - consumer failures are isolated (best-effort delivery, run never affected)
 */
import { describe, expect, it } from 'vitest';
import { createEventBus, type Event } from '../../../packages/events/src/bus';

function publishSequence(events: Event[]): number[] {
  return events.map((event) => event.sequence);
}

describe('EventBus', () => {
  it('fills protocol fields and assigns session-monotonic sequence across producers', () => {
    const bus = createEventBus({ id: () => 'evt:1', now: () => '2026-08-04T00:00:00.000Z' });
    const received: Event[] = [];
    bus.subscribe({}, (event) => { received.push(event); });

    // Two producers interleave on the same session — like engine and session
    // emitting concurrently. The bus is the only counter; producers never coordinate.
    bus.publish({ type: 'run.started', payload: { requestId: 'req:1' }, sessionId: 'session:1', runId: 'run:1' });
    bus.publish({ type: 'branch_marker.created', payload: { markerId: 'marker:1' }, sessionId: 'session:1' });
    bus.publish({ type: 'run.ended', payload: { status: 'completed' }, sessionId: 'session:1', runId: 'run:1' });

    expect(publishSequence(received)).toEqual([1, 2, 3]);
    for (const event of received) {
      expect(event.id).toBe('evt:1');
      expect(event.createdAt).toBe('2026-08-04T00:00:00.000Z');
    }
  });

  it('numbers each session independently from 1', () => {
    const bus = createEventBus();
    const received: Event[] = [];
    bus.subscribe({}, (event) => { received.push(event); });

    bus.publish({ type: 'run.started', payload: { requestId: 'req:1' }, sessionId: 'session:1', runId: 'run:1' });
    bus.publish({ type: 'run.started', payload: { requestId: 'req:2' }, sessionId: 'session:2', runId: 'run:2' });

    expect(received.map((event) => event.sequence)).toEqual([1, 1]);
  });

  it('honors an explicit id and createdAt from the producer', () => {
    const bus = createEventBus();
    const received: Event[] = [];
    bus.subscribe({}, (event) => { received.push(event); });

    bus.publish({
      type: 'message.started',
      payload: { role: 'user', messageId: 'message:1' },
      sessionId: 'session:1',
      id: 'evt:custom',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(received[0]?.id).toBe('evt:custom');
    expect(received[0]?.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('filters subscribers by sessionId, runId, and eventTypes', () => {
    const bus = createEventBus();
    const sessionOnly: Event[] = [];
    const runOnly: Event[] = [];
    const terminalOnly: Event[] = [];

    bus.subscribe({ sessionId: 'session:1' }, (event) => { sessionOnly.push(event); });
    bus.subscribe({ runId: 'run:1' }, (event) => { runOnly.push(event); });
    bus.subscribe({ eventTypes: ['run.ended'] }, (event) => { terminalOnly.push(event); });

    bus.publish({ type: 'run.started', payload: { requestId: 'req:1' }, sessionId: 'session:1', runId: 'run:1' });
    bus.publish({ type: 'run.started', payload: { requestId: 'req:2' }, sessionId: 'session:2', runId: 'run:2' });
    bus.publish({ type: 'run.ended', payload: { status: 'completed' }, sessionId: 'session:1', runId: 'run:1' });

    expect(sessionOnly.map((event) => event.type)).toEqual(['run.started', 'run.ended']);
    expect(runOnly.map((event) => event.type)).toEqual(['run.started', 'run.ended']);
    expect(terminalOnly.map((event) => event.type)).toEqual(['run.ended']);
  });

  it('applies a filter as an intersection when several dimensions are given', () => {
    const bus = createEventBus();
    const received: Event[] = [];
    bus.subscribe({ sessionId: 'session:1', eventTypes: ['run.ended'] }, (event) => { received.push(event); });

    bus.publish({ type: 'run.started', payload: { requestId: 'req:1' }, sessionId: 'session:1', runId: 'run:1' });
    bus.publish({ type: 'run.ended', payload: { status: 'completed' }, sessionId: 'session:1', runId: 'run:1' });
    bus.publish({ type: 'run.ended', payload: { status: 'failed', error: { message: 'x' } }, sessionId: 'session:2', runId: 'run:2' });

    expect(received.map((event) => event.type)).toEqual(['run.ended']);
  });

  it('isolates consumer failures: other subscribers still receive, publish never rejects', () => {
    const diagnostics: unknown[] = [];
    const bus = createEventBus({
      onConsumerError: (failure) => { diagnostics.push(failure); },
    });
    const received: Event[] = [];

    bus.subscribe({}, () => { throw new Error('subscriber broke'); });
    bus.subscribe({}, (event) => { received.push(event); });

    expect(() => {
      bus.publish({ type: 'run.started', payload: { requestId: 'req:1' }, sessionId: 'session:1' });
    }).not.toThrow();
    expect(received).toHaveLength(1);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      eventType: 'run.started',
      sessionId: 'session:1',
    });
  });

  it('excludes subscribers added during delivery and stops after unsubscribe', () => {
    const bus = createEventBus();
    const late: Event[] = [];
    const subscribed: Event[] = [];

    const subscription = bus.subscribe({}, (event) => { subscribed.push(event); });
    bus.subscribe({}, () => {
      bus.subscribe({}, (event) => { late.push(event); });
    });

    bus.publish({ type: 'run.started', payload: { requestId: 'req:1' }, sessionId: 'session:1' });
    subscription.unsubscribe();
    bus.publish({ type: 'run.ended', payload: { status: 'cancelled' }, sessionId: 'session:1' });

    expect(subscribed.map((event) => event.type)).toEqual(['run.started']); // unsubscribed: stops
    expect(late.map((event) => event.type)).toEqual(['run.ended']); // added mid-delivery: next round only
  });
});
