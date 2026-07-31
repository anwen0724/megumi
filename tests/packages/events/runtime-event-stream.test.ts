/*
 * Protects runtime text-delta coalescing boundaries.
 */
import { describe, expect, it } from 'vitest';
import type { RuntimeEvent } from '../../../packages/events/src/index';
import { coalesceTextDeltaRuntimeEvents } from '../../../packages/events/src/runtime-event-stream';

function deltaEvent(sequence: number, delta: string, modelCallId?: string): RuntimeEvent {
  const eventType = modelCallId ? 'model_call.text_delta' : 'assistant.output.delta';
  return {
    eventId: `event:${sequence}`, schemaVersion: 1, eventType, runId: 'run:1', sequence,
    createdAt: '2026-01-01T00:00:00.000Z', source: 'provider', visibility: 'user', persist: 'transient',
    payload: modelCallId ? { modelCallId, delta } : { delta },
  };
}

async function* events(...items: RuntimeEvent[]): AsyncIterable<RuntimeEvent> {
  yield* items;
}

describe('runtime event stream coalescing', () => {
  it('coalesces adjacent assistant deltas without changing the envelope identity', async () => {
    const result: RuntimeEvent[] = [];
    for await (const item of coalesceTextDeltaRuntimeEvents(
      events(deltaEvent(1, 'a'), deltaEvent(2, 'b')),
      { maxChars: 2 },
    )) result.push(item);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ eventId: 'event:1', sequence: 1, payload: { delta: 'ab' } });
  });

  it('does not merge deltas from different model calls', async () => {
    const result: RuntimeEvent[] = [];
    for await (const item of coalesceTextDeltaRuntimeEvents(
      events(deltaEvent(1, 'a', 'model:1'), deltaEvent(2, 'b', 'model:2')),
      { maxChars: 10 },
    )) result.push(item);

    expect(result.map((item) => item.payload)).toEqual([
      { modelCallId: 'model:1', delta: 'a' },
      { modelCallId: 'model:2', delta: 'b' },
    ]);
  });
});
