import { describe, expect, it } from 'vitest';
import type { RuntimeEvent } from '@megumi/events';
import { createRunProjection } from '@megumi/projections';

describe('RunProjection', () => {
  it('derives Run state only from Runtime Events', () => {
    const projection = createRunProjection();
    projection.project(eventFixture('run.started'));
    projection.project(eventFixture('run.waiting', 'event:2'));
    expect(projection.listRuns({ sessionId: 'session:1' })[0]?.status).toBe('waiting');
    expect(projection.isRunLive({ runId: 'run:1' })).toBe(true);

    projection.project(eventFixture('run.cancel.requested', 'event:3'));
    expect(projection.getRun({ runId: 'run:1' })?.status).toBe('cancelling');

    projection.project(eventFixture('run.cancelled', 'event:4'));
    expect(projection.getRun({ runId: 'run:1' })?.status).toBe('cancelled');
    expect(projection.isRunLive({ runId: 'run:1' })).toBe(false);
  });

  it('bounds retained terminal Runs and per-Run Events', () => {
    const projection = createRunProjection({
      maxRuns: 2,
      maxEventsPerRun: 2,
      terminalRetentionMs: 10_000,
      nowMs: () => 1,
    });
    for (let index = 1; index <= 3; index++) {
      projection.project(eventFixture('run.started', `event:start:${index}`, `run:${index}`));
      projection.project(eventFixture('run.completed', `event:end:${index}`, `run:${index}`));
    }
    expect(projection.listRuns({ sessionId: 'session:1' }).map((run) => run.runId)).toEqual([
      'run:2',
      'run:3',
    ]);

    projection.project(eventFixture('run.started', 'event:1', 'run:live'));
    projection.project(eventFixture('run.waiting', 'event:2', 'run:live'));
    projection.project(eventFixture('run.resumed', 'event:3', 'run:live'));
    expect(projection.listEvents({ runId: 'run:live' }).map((event) => event.eventId)).toEqual([
      'event:2',
      'event:3',
    ]);
  });
});

function eventFixture(
  eventType: RuntimeEvent['eventType'],
  eventId = 'event:1',
  runId = 'run:1',
): RuntimeEvent {
  return {
    eventId,
    schemaVersion: 1,
    eventType,
    runId,
    workspaceId: 'workspace:1',
    sessionId: 'session:1',
    requestId: 'request:1',
    sequence: 1,
    createdAt: '2026-07-10T00:00:01.000Z',
    source: 'core',
    visibility: 'system',
    persist: 'transient',
    payload: {},
  } as RuntimeEvent;
}
