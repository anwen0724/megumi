/*
 * Verifies the bus contract at its public seam:
 *  - publish fills protocol fields (id, sequence, createdAt)
 *  - sequence is session-monotonic across producers (broadcast's entry fee)
 *  - subscribe filters by sessionId / executionId / eventTypes
 *  - consumer failures are isolated (best-effort delivery, run never affected)
 */
import { describe, expect, it } from 'vitest';
import { createEventBus } from '../../../packages/agent/events/src/bus';
import type { Event } from '../../../packages/agent/events/src/event';

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
    bus.publish({ type: 'run.started', payload: { requestId: 'req:1', providerId: 'provider:1', modelId: 'model:1' }, sessionId: 'session:1', executionId: 'run:1' });
    bus.publish({ type: 'session.branch_marker.created', payload: { markerId: 'marker:1' }, sessionId: 'session:1' });
    bus.publish({ type: 'run.ended', payload: { status: 'completed' }, sessionId: 'session:1', executionId: 'run:1' });

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

    bus.publish({ type: 'run.started', payload: { requestId: 'req:1', providerId: 'provider:1', modelId: 'model:1' }, sessionId: 'session:1', executionId: 'run:1' });
    bus.publish({ type: 'run.started', payload: { requestId: 'req:2', providerId: 'provider:1', modelId: 'model:1' }, sessionId: 'session:2', executionId: 'run:2' });

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

  it('filters subscribers by sessionId, executionId, and eventTypes', () => {
    const bus = createEventBus();
    const sessionOnly: Event[] = [];
    const runOnly: Event[] = [];
    const terminalOnly: Event[] = [];

    bus.subscribe({ sessionId: 'session:1' }, (event) => { sessionOnly.push(event); });
    bus.subscribe({ executionId: 'run:1' }, (event) => { runOnly.push(event); });
    bus.subscribe({ eventTypes: ['run.ended'] }, (event) => { terminalOnly.push(event); });

    bus.publish({ type: 'run.started', payload: { requestId: 'req:1', providerId: 'provider:1', modelId: 'model:1' }, sessionId: 'session:1', executionId: 'run:1' });
    bus.publish({ type: 'run.started', payload: { requestId: 'req:2', providerId: 'provider:1', modelId: 'model:1' }, sessionId: 'session:2', executionId: 'run:2' });
    bus.publish({ type: 'run.ended', payload: { status: 'completed' }, sessionId: 'session:1', executionId: 'run:1' });

    expect(sessionOnly.map((event) => event.type)).toEqual(['run.started', 'run.ended']);
    expect(runOnly.map((event) => event.type)).toEqual(['run.started', 'run.ended']);
    expect(terminalOnly.map((event) => event.type)).toEqual(['run.ended']);
  });

  it('applies a filter as an intersection when several dimensions are given', () => {
    const bus = createEventBus();
    const received: Event[] = [];
    bus.subscribe({ sessionId: 'session:1', eventTypes: ['run.ended'] }, (event) => { received.push(event); });

    bus.publish({ type: 'run.started', payload: { requestId: 'req:1', providerId: 'provider:1', modelId: 'model:1' }, sessionId: 'session:1', executionId: 'run:1' });
    bus.publish({ type: 'run.ended', payload: { status: 'completed' }, sessionId: 'session:1', executionId: 'run:1' });
    bus.publish({ type: 'run.ended', payload: { status: 'failed', error: { message: 'x' } }, sessionId: 'session:2', executionId: 'run:2' });

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
      bus.publish({ type: 'run.started', payload: { requestId: 'req:1', providerId: 'provider:1', modelId: 'model:1' }, sessionId: 'session:1' });
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

    bus.publish({ type: 'run.started', payload: { requestId: 'req:1', providerId: 'provider:1', modelId: 'model:1' }, sessionId: 'session:1' });
    subscription.unsubscribe();
    bus.publish({ type: 'run.ended', payload: { status: 'cancelled' }, sessionId: 'session:1' });

    expect(subscribed.map((event) => event.type)).toEqual(['run.started']); // unsubscribed: stops
    expect(late.map((event) => event.type)).toEqual(['run.ended']); // added mid-delivery: next round only
  });

  it('buffers before delivery and returns ordered copies without changing the available range', () => {
    const bus = createEventBus({
      id: (() => { let value = 0; return () => `evt:${++value}`; })(),
      recentEvents: { maxSessions: 2, maxEventsPerSession: 3 },
    });
    const seenDuringDelivery: number[] = [];
    bus.subscribe({ sessionId: 'session:1' }, () => {
      seenDuringDelivery.push(bus.read({ sessionId: 'session:1' }).events.length);
    });

    publishStarted(bus, 'session:1', 'run:1');
    publishStarted(bus, 'session:1', 'run:2');
    publishStarted(bus, 'session:1', 'run:3');

    expect(seenDuringDelivery).toEqual([1, 2, 3]);
    const filtered = bus.read({ sessionId: 'session:1', afterSequence: 1 });
    expect(filtered.events.map((event) => event.sequence)).toEqual([2, 3]);
    expect(filtered).toMatchObject({ firstSequence: 1, lastSequence: 3, truncated: false });

    const mutable = filtered.events as unknown as Array<{
      payload: { requestId: string; providerId: string; modelId: string };
    }>;
    mutable[0]!.payload = { requestId: 'changed', providerId: 'changed', modelId: 'changed' };
    expect(bus.read({ sessionId: 'session:1' }).events[1]?.payload).toMatchObject({ requestId: 'request:run:2' });
  });

  it('bounds each Session payload while preserving sequence metadata for gap detection', () => {
    const bus = createEventBus({ recentEvents: { maxSessions: 2, maxEventsPerSession: 2 } });
    publishStarted(bus, 'session:1', 'run:1');
    publishStarted(bus, 'session:1', 'run:2');
    publishStarted(bus, 'session:1', 'run:3');

    expect(bus.read({ sessionId: 'session:1' })).toMatchObject({
      firstSequence: 2,
      lastSequence: 3,
      truncated: true,
      events: [{ sequence: 2 }, { sequence: 3 }],
    });
    expect(bus.read({ sessionId: 'session:1', afterSequence: 2 })).toMatchObject({
      firstSequence: 2,
      lastSequence: 3,
      truncated: false,
      events: [{ sequence: 3 }],
    });
  });

  it('evicts least-recently-published Session payloads and read does not refresh that order', () => {
    const bus = createEventBus({ recentEvents: { maxSessions: 2, maxEventsPerSession: 2 } });
    publishStarted(bus, 'session:1', 'run:1');
    publishStarted(bus, 'session:2', 'run:2');
    bus.read({ sessionId: 'session:1' });
    publishStarted(bus, 'session:3', 'run:3');

    expect(bus.read({ sessionId: 'session:1' })).toEqual({ events: [], truncated: true });
    expect(bus.read({ sessionId: 'session:2' }).events).toHaveLength(1);
    expect(bus.read({ sessionId: 'session:3' }).events).toHaveLength(1);
    expect(bus.read({ sessionId: 'session:new' })).toEqual({ events: [], truncated: false });
  });

  it('does not wait for asynchronous subscribers before the event becomes readable', () => {
    const bus = createEventBus({ recentEvents: { maxSessions: 1, maxEventsPerSession: 1 } });
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    bus.subscribe({}, async () => pending);

    bus.publish({
      type: 'run.started',
      payload: { requestId: 'request:1', providerId: 'provider:1', modelId: 'model:1' },
      sessionId: 'session:1',
    });

    expect(bus.read({ sessionId: 'session:1' }).events).toHaveLength(1);
    release();
  });
});

function publishStarted(
  bus: ReturnType<typeof createEventBus>,
  sessionId: string,
  executionId: string,
): void {
  bus.publish({
    type: 'run.started',
    payload: { requestId: `request:${executionId}`, providerId: 'provider:1', modelId: 'model:1' },
    sessionId,
    executionId,
  });
}
