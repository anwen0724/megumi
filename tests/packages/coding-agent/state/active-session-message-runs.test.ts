import { describe, expect, it } from 'vitest';
import { ActiveSessionMessageRunTracker } from '@megumi/coding-agent/state';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import type { Run } from '@megumi/shared/session';

function event(eventType: 'run.started' | 'run.completed'): RuntimeEvent {
  return {
    eventId: `event:${eventType}`,
    eventType,
    schemaVersion: 1,
    runId: 'run-1',
    sessionId: 'session-1',
    sequence: 1,
    createdAt: '2026-06-29T00:00:00.000Z',
    source: 'core',
    visibility: 'user',
    persist: 'required',
    payload: {},
  };
}

async function collect(events: AsyncIterable<RuntimeEvent>): Promise<RuntimeEvent[]> {
  const collected: RuntimeEvent[] = [];
  for await (const item of events) {
    collected.push(item);
  }
  return collected;
}

async function* events(): AsyncIterable<RuntimeEvent> {
  yield event('run.started');
  yield event('run.completed');
}

describe('ActiveSessionMessageRunTracker', () => {
  it('registers and forgets active session message runs through the state owner', () => {
    const tracker = new ActiveSessionMessageRunTracker<{ streamId: string }>();

    tracker.register('request-1', {
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      projection: { streamId: 'stream-1' },
    });

    expect(tracker.get('request-1')).toEqual({
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      projection: { streamId: 'stream-1' },
    });

    tracker.forget('request-1');

    expect(tracker.get('request-1')).toBeUndefined();
  });

  it('forgets completed runs when the tracked event stream ends', async () => {
    const tracker = new ActiveSessionMessageRunTracker();
    tracker.register('request-1', {
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
    });

    await expect(collect(tracker.track({
      requestId: 'request-1',
      events: events(),
      getRunStatus: () => 'completed',
    }))).resolves.toHaveLength(2);

    expect(tracker.get('request-1')).toBeUndefined();
  });

  it('keeps approval-waiting runs tracked after the event stream pauses', async () => {
    const tracker = new ActiveSessionMessageRunTracker();
    tracker.register('request-1', {
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
    });

    await collect(tracker.track({
      requestId: 'request-1',
      events: events(),
      getRunStatus: (): Run['status'] => 'waiting_for_approval',
    }));

    expect(tracker.get('request-1')).toMatchObject({
      runId: 'run-1',
    });
  });
});
