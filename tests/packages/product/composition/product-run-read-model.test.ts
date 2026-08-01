import { describe, expect, it } from 'vitest';
import type { RuntimeEvent } from '@megumi/events';
import type { Run } from '@megumi/engine';
import { ProductRunReadModel } from '../../../../packages/product/src/run-read-model';

describe('ProductRunReadModel', () => {
  it('projects waiting and cancelling states and resolves terminal convergence', async () => {
    const readModel = new ProductRunReadModel();
    readModel.recordRun(runFixture());
    readModel.recordEvent(eventFixture('run.waiting'));
    expect(readModel.listRunsBySession('session:1')[0]?.status).toBe('waiting');

    readModel.recordEvent(eventFixture('run.cancel.requested'));
    expect(readModel.listRunsBySession('session:1')[0]?.status).toBe('cancelling');

    const convergence = readModel.waitForConvergence(1_000);
    readModel.recordEvent(eventFixture('run.cancelled'));
    await expect(convergence).resolves.toBe(true);
    expect(readModel.listRunsBySession('session:1')[0]?.status).toBe('cancelled');
  });

  it('bounds retained Runs and per-Run Events', () => {
    const readModel = new ProductRunReadModel({
      maxRuns: 2,
      maxEventsPerRun: 2,
      terminalRetentionMs: 10_000,
      nowMs: () => 1,
    });
    for (let index = 1; index <= 3; index++) {
      readModel.recordRun(runFixture({
        runId: `run:${index}`,
        requestId: `request:${index}`,
        status: 'completed',
        completedAt: '2026-07-10T00:00:01.000Z',
      }));
    }
    expect(readModel.listRunsBySession('session:1').map((run) => run.runId)).toEqual([
      'run:2',
      'run:3',
    ]);

    readModel.recordRun(runFixture({ runId: 'run:live' }));
    readModel.recordEvent(eventFixture('run.started', 'event:1', 'run:live'));
    readModel.recordEvent(eventFixture('run.waiting', 'event:2', 'run:live'));
    readModel.recordEvent(eventFixture('run.resumed', 'event:3', 'run:live'));
    expect(readModel.listEventsByRun('run:live').map((event) => event.eventId)).toEqual([
      'event:2',
      'event:3',
    ]);
  });
});

function runFixture(overrides: Partial<Run> = {}): Run {
  return {
    runId: 'run:1',
    requestId: 'request:1',
    workspaceId: 'workspace:1',
    sessionId: 'session:1',
    userMessageId: 'message:1',
    model: {} as Run['model'],
    permissionMode: 'ask',
    status: 'running',
    createdAt: '2026-07-10T00:00:00.000Z',
    startedAt: '2026-07-10T00:00:00.000Z',
    ...overrides,
  };
}

function eventFixture(
  eventType: RuntimeEvent['eventType'],
  eventId = 'event:1',
  runId = 'run:1',
): RuntimeEvent {
  return {
    eventId,
    eventType,
    runId,
    sessionId: 'session:1',
    sequence: 1,
    createdAt: '2026-07-10T00:00:01.000Z',
    payload: {},
  } as RuntimeEvent;
}
