// @vitest-environment node
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '@megumi/coding-agent/persistence/schema/migrations';
import { RuntimeEventRepository } from '@megumi/coding-agent/persistence/repos/runtime-event.repo';
import { SessionRunRepository } from '@megumi/coding-agent/persistence/repos/session-run.repo';
import type { RuntimeEvent } from '@megumi/shared/runtime';

let db: Database.Database | null = null;

function createRepositories(): {
  runtimeEventRepository: RuntimeEventRepository;
  sessionRunRepository: SessionRunRepository;
} {
  db = new Database(':memory:');
  migrateDatabase(db);
  return {
    runtimeEventRepository: new RuntimeEventRepository(db),
    sessionRunRepository: new SessionRunRepository(db),
  };
}

afterEach(() => {
  db?.close();
  db = null;
});

describe('RuntimeEventRepository', () => {
  it('appends runtime events, lists them by run sequence, and rejects duplicate run sequences', () => {
    const { runtimeEventRepository, sessionRunRepository } = createRepositories();
    sessionRunRepository.saveSession({
      sessionId: 'session-1',
      title: 'Lifecycle',
      status: 'active',
      createdAt: '2026-05-15T00:00:00.000Z',
      updatedAt: '2026-05-15T00:00:00.000Z',
    });
    sessionRunRepository.saveRun({
      runId: 'run-1',
      sessionId: 'session-1',
      mode: 'chat',
      goal: 'Answer',
      status: 'running',
      createdAt: '2026-05-15T00:00:01.000Z',
    });

    const firstEvent: RuntimeEvent = {
      eventId: 'event-1',
      schemaVersion: 1,
      eventType: 'run.started',
      runId: 'run-1',
      sessionId: 'session-1',
      sequence: 1,
      createdAt: '2026-05-15T00:00:02.000Z',
      source: 'core',
      visibility: 'user',
      persist: 'required',
      payload: { runKind: 'agent' },
    };
    const secondEvent: RuntimeEvent = {
      ...firstEvent,
      eventId: 'event-2',
      eventType: 'run.completed',
      sequence: 2,
      createdAt: '2026-05-15T00:00:03.000Z',
      payload: { status: 'completed' },
    };

    runtimeEventRepository.appendRuntimeEvent(secondEvent);
    runtimeEventRepository.appendRuntimeEvent(firstEvent);

    expect(runtimeEventRepository.listRuntimeEventsByRun('run-1')).toEqual([firstEvent, secondEvent]);
    expect(() => runtimeEventRepository.appendRuntimeEvent({ ...firstEvent, eventId: 'event-3' })).toThrow();
  });
});
