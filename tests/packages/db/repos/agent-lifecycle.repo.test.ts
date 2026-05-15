// @vitest-environment node
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '@megumi/db/schema/migrations';
import { AgentLifecycleRepository } from '@megumi/db/repos/agent-lifecycle.repo';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';

let db: Database.Database | null = null;

function createRepo(): AgentLifecycleRepository {
  db = new Database(':memory:');
  migrateDatabase(db);
  return new AgentLifecycleRepository(db);
}

afterEach(() => {
  db?.close();
  db = null;
});

describe('AgentLifecycleRepository', () => {
  it('saves and reads session, message, run, step, action, and observation facts', () => {
    const repo = createRepo();

    repo.saveSession({
      sessionId: 'session-1',
      title: 'Lifecycle',
      status: 'active',
      createdAt: '2026-05-15T00:00:00.000Z',
      updatedAt: '2026-05-15T00:00:00.000Z',
    });
    repo.saveMessage({
      messageId: 'message-1',
      sessionId: 'session-1',
      role: 'user',
      content: 'Hello',
      status: 'completed',
      createdAt: '2026-05-15T00:00:01.000Z',
      completedAt: '2026-05-15T00:00:01.000Z',
    });
    repo.saveRun({
      runId: 'run-1',
      sessionId: 'session-1',
      triggerMessageId: 'message-1',
      mode: 'chat',
      goal: 'Answer',
      status: 'queued',
      createdAt: '2026-05-15T00:00:02.000Z',
    });
    repo.saveStep({
      stepId: 'step-1',
      runId: 'run-1',
      kind: 'model',
      status: 'pending',
    });
    repo.saveAction({
      actionId: 'action-1',
      runId: 'run-1',
      stepId: 'step-1',
      kind: 'emit_message',
      status: 'requested',
      requestedAt: '2026-05-15T00:00:03.000Z',
    });
    repo.saveObservation({
      observationId: 'observation-1',
      runId: 'run-1',
      stepId: 'step-1',
      actionId: 'action-1',
      source: 'runtime',
      kind: 'message_emitted',
      receivedAt: '2026-05-15T00:00:04.000Z',
      summary: 'Message emitted',
    });

    expect(repo.getSession('session-1')?.title).toBe('Lifecycle');
    expect(repo.listMessagesBySession('session-1')).toHaveLength(1);
    expect(repo.getRun('run-1')?.status).toBe('queued');
    expect(repo.listStepsByRun('run-1')[0]).toMatchObject({ kind: 'model' });
    expect(repo.listActionsByRun('run-1')[0]).toMatchObject({ kind: 'emit_message' });
    expect(repo.listObservationsByRun('run-1')[0]).toMatchObject({ summary: 'Message emitted' });
  });

  it('appends runtime events and rejects duplicate run sequences', () => {
    const repo = createRepo();
    repo.saveSession({
      sessionId: 'session-1',
      title: 'Lifecycle',
      status: 'active',
      createdAt: '2026-05-15T00:00:00.000Z',
      updatedAt: '2026-05-15T00:00:00.000Z',
    });
    repo.saveRun({
      runId: 'run-1',
      sessionId: 'session-1',
      mode: 'chat',
      goal: 'Answer',
      status: 'running',
      createdAt: '2026-05-15T00:00:01.000Z',
    });

    const event: RuntimeEvent = {
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

    repo.appendRuntimeEvent(event);
    expect(repo.listRuntimeEventsByRun('run-1')).toEqual([event]);
    expect(() => repo.appendRuntimeEvent({ ...event, eventId: 'event-2' })).toThrow();
  });
});
