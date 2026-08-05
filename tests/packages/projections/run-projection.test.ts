import { describe, expect, it } from 'vitest';
import type { AnyEvent } from '@megumi/events';
import { createRunProjection } from '@megumi/projections';

describe('RunProjection', () => {
  it('derives Run state only from Runtime Events', () => {
    const projection = createRunProjection();
    projection.project(eventFixture('run.started'));
    projection.project(eventFixture('run.ended', { status: 'cancelled' }));
    expect(projection.getRun({ runId: 'run:1' })?.status).toBe('cancelled');
    expect(projection.isRunLive({ runId: 'run:1' })).toBe(false);
  });

  it('tracks a live Run through its lifecycle', () => {
    const projection = createRunProjection();
    projection.project(eventFixture('run.started'));
    expect(projection.listRuns({ sessionId: 'session:1' })[0]?.status).toBe('running');
    expect(projection.isRunLive({ runId: 'run:1' })).toBe(true);

    projection.project(eventFixture('run.ended', { status: 'completed' }));
    expect(projection.getRun({ runId: 'run:1' })?.status).toBe('completed');
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
      projection.project(eventFixture('run.started', {}, `event:start:${index}`, `run:${index}`));
      projection.project(eventFixture('run.ended', { status: 'completed' }, `event:end:${index}`, `run:${index}`));
    }
    expect(projection.listRuns({ sessionId: 'session:1' }).map((run) => run.runId)).toEqual([
      'run:2',
      'run:3',
    ]);

    projection.project(eventFixture('run.started', {}, 'event:1', 'run:live'));
    projection.project(eventFixture('turn.started', { messageId: 'message:1' }, 'event:2', 'run:live'));
    projection.project(eventFixture('turn.ended', { stopReason: 'completed', messageId: 'message:1', toolCallIds: [] }, 'event:3', 'run:live'));
    expect(projection.listEvents({ runId: 'run:live' }).map((event) => event.id)).toEqual([
      'event:2',
      'event:3',
    ]);
  });
});

function eventFixture(
  eventType: AnyEvent['type'],
  payload: Record<string, unknown> = {},
  eventId = 'event:1',
  runId = 'run:1',
): AnyEvent {
  return {
    id: eventId,
    type: eventType,
    payload,
    runId,
    sessionId: 'session:1',
    sequence: 1,
    createdAt: '2026-07-10T00:00:01.000Z',
  } as AnyEvent;
}
