// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  openSqliteDatabase,
  runDatabaseMigrations,
  SqliteRuntimeEventRepository,
} from '../../../src/database';
import type { AgentRuntimeEvent } from '../../../src/app';

describe('SqliteRuntimeEventRepository', () => {
  it('persists runtime events by run without using the live event bus as history', () => {
    const database = openSqliteDatabase(':memory:');
    runDatabaseMigrations(database, { now: () => '2026-06-20T00:00:00.000Z' });
    const repository = new SqliteRuntimeEventRepository(database);

    const event: AgentRuntimeEvent = {
      type: 'run.started',
      runId: 'run-1',
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      occurredAt: '2026-06-20T00:00:01.000Z',
      payload: { inputSummary: 'hello' },
    };

    repository.saveEvent(event);
    repository.saveEvent({
      type: 'run.completed',
      runId: 'run-1',
      sessionId: 'session-1',
      occurredAt: '2026-06-20T00:00:02.000Z',
      payload: { status: 'completed' },
    });

    expect(repository.listEventsByRun('run-1')).toEqual([
      expect.objectContaining({ type: 'run.started', runId: 'run-1', sequence: 1 }),
      expect.objectContaining({ type: 'run.completed', runId: 'run-1', sequence: 2 }),
    ]);
    expect(repository.listEventsByRun('missing-run')).toEqual([]);
    database.close();
  });
});
