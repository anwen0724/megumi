// @vitest-environment node
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '@megumi/db/schema/migrations';
import { SessionRunRepository } from '@megumi/db/repos/session-run.repo';
import { SessionActivePathRepository } from '@megumi/db/repos/session-active-path.repo';
import type { SessionCompactionEntry } from '@megumi/shared/session-compaction-contracts';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';

let db: Database.Database | null = null;

function createRepo(): SessionRunRepository {
  db = new Database(':memory:');
  migrateDatabase(db);
  return new SessionRunRepository(db);
}

afterEach(() => {
  db?.close();
  db = null;
});

describe('SessionRunRepository', () => {
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
    expect(repo.listRunsBySession('session-1')).toEqual([
      expect.objectContaining({ runId: 'run-1', sessionId: 'session-1' }),
    ]);
    expect(repo.listStepsByRun('run-1')[0]).toMatchObject({ kind: 'model' });
    expect(repo.listActionsByRun('run-1')[0]).toMatchObject({ kind: 'emit_message' });
    expect(repo.listObservationsByRun('run-1')[0]).toMatchObject({ summary: 'Message emitted' });
  });

  it('lists runs for one session in creation order', () => {
    const repo = createRepo();
    repo.saveSession({
      sessionId: 'session-1',
      title: 'First session',
      status: 'active',
      createdAt: '2026-05-15T00:00:00.000Z',
      updatedAt: '2026-05-15T00:00:00.000Z',
    });
    repo.saveSession({
      sessionId: 'session-2',
      title: 'Second session',
      status: 'active',
      createdAt: '2026-05-15T00:00:00.000Z',
      updatedAt: '2026-05-15T00:00:00.000Z',
    });
    repo.saveRun({
      runId: 'run-2',
      sessionId: 'session-1',
      mode: 'default',
      goal: 'Second',
      status: 'completed',
      createdAt: '2026-05-15T00:00:02.000Z',
    });
    repo.saveRun({
      runId: 'run-other',
      sessionId: 'session-2',
      mode: 'default',
      goal: 'Other',
      status: 'completed',
      createdAt: '2026-05-15T00:00:03.000Z',
    });
    repo.saveRun({
      runId: 'run-1',
      sessionId: 'session-1',
      mode: 'default',
      goal: 'First',
      status: 'completed',
      createdAt: '2026-05-15T00:00:01.000Z',
    });

    expect(repo.listRunsBySession('session-1').map((run) => run.runId)).toEqual(['run-1', 'run-2']);
  });

  it('gets one session message by id', () => {
    const repo = createRepo();
    repo.saveSession({
      sessionId: 'session-1',
      title: 'One message',
      status: 'active',
      createdAt: '2026-06-01T08:00:00.000Z',
      updatedAt: '2026-06-01T08:00:00.000Z',
    });
    repo.saveMessage({
      messageId: 'message-1',
      sessionId: 'session-1',
      role: 'user',
      content: 'Hello',
      status: 'completed',
      createdAt: '2026-06-01T08:01:00.000Z',
      completedAt: '2026-06-01T08:01:00.000Z',
    });

    expect(repo.getMessage('message-1')?.content).toBe('Hello');
    expect(repo.getMessage('message-missing')).toBeUndefined();
  });

  it('saves and reads session compactions by id, session, and latest completed', () => {
    const repo = createRepo();
    repo.saveSession({
      sessionId: 'session-1',
      title: 'Compaction session',
      status: 'active',
      createdAt: '2026-05-31T10:00:00.000Z',
      updatedAt: '2026-05-31T10:00:00.000Z',
    });

    const firstCompaction: SessionCompactionEntry = {
      compactionId: 'compaction-1',
      sessionId: 'session-1',
      summary: '第一段摘要',
      summaryKind: 'compaction',
      firstKeptSourceRef: {
        sourceId: 'message-3',
        sourceKind: 'session_message',
        loadedAt: '2026-05-31T10:00:00.000Z',
      },
      tokensBefore: 180000,
      triggerReason: 'context_budget_pressure',
      status: 'completed',
      createdAt: '2026-05-31T10:05:00.000Z',
      metadata: {
        summarizedSourceCount: 2,
      },
    };

    const secondCompaction: SessionCompactionEntry = {
      ...firstCompaction,
      compactionId: 'compaction-2',
      summary: '第二段摘要',
      firstKeptSourceRef: {
        sourceId: 'message-6',
        sourceKind: 'session_message',
        loadedAt: '2026-05-31T10:10:00.000Z',
      },
      tokensBefore: 190000,
      createdAt: '2026-05-31T10:15:00.000Z',
      metadata: {
        previousCompactionId: 'compaction-1',
        summarizedSourceCount: 3,
      },
    };

    repo.saveSessionCompaction(firstCompaction);
    repo.saveSessionCompaction(secondCompaction);

    expect(repo.getSessionCompaction('compaction-1')).toEqual(firstCompaction);
    expect(repo.listSessionCompactionsBySession('session-1')).toEqual([
      secondCompaction,
      firstCompaction,
    ]);
    expect(repo.getLatestCompletedSessionCompaction('session-1')).toEqual(
      secondCompaction,
    );
    expect(repo.getSessionCompaction('missing-compaction')).toBeNull();
    expect(repo.getLatestCompletedSessionCompaction('missing-session')).toBeNull();
  });

  it('atomically saves session compaction with active path source attribution', () => {
    const repo = createRepo();
    const activePathRepo = new SessionActivePathRepository(db!);
    repo.saveSession({
      sessionId: 'session-1',
      title: 'Session',
      status: 'active',
      createdAt: '2026-05-31T12:00:00.000Z',
      updatedAt: '2026-05-31T12:00:00.000Z',
    });
    activePathRepo.appendSourceEntryAndSetActiveLeaf({
      sourceEntryId: 'source-entry-message-1',
      sessionId: 'session-1',
      sourceRef: {
        sourceKind: 'session_message',
        sourceId: 'message-1',
        sourceUri: 'session-message://message-1',
        loadedAt: '2026-05-31T12:01:00.000Z',
      },
      createdAt: '2026-05-31T12:01:00.000Z',
    }, {
      sessionId: 'session-1',
      leafSourceEntryId: 'source-entry-message-1',
      updatedAt: '2026-05-31T12:01:00.000Z',
      reason: 'source_appended',
    });
    const compaction: SessionCompactionEntry = {
      compactionId: 'compaction-1',
      sessionId: 'session-1',
      summary: 'Compacted summary.',
      summaryKind: 'compaction',
      firstKeptSourceRef: {
        sourceKind: 'session_message',
        sourceId: 'message-1',
        sourceUri: 'session-message://message-1',
        loadedAt: '2026-05-31T12:01:00.000Z',
      },
      tokensBefore: 9000,
      triggerReason: 'context_budget_pressure',
      status: 'completed',
      createdAt: '2026-05-31T12:02:00.000Z',
    };

    const result = repo.saveSessionCompactionWithActivePath({
      compaction,
      sourceEntry: {
        sourceEntryId: 'source-entry-compaction-1',
        sessionId: 'session-1',
        parentSourceEntryId: 'source-entry-message-1',
        sourceRef: {
          sourceKind: 'session_summary',
          sourceId: 'compaction-1',
          sourceUri: 'session-compaction://compaction-1',
          loadedAt: '2026-05-31T12:02:00.000Z',
        },
        createdAt: '2026-05-31T12:02:00.000Z',
      },
      activeLeaf: {
        sessionId: 'session-1',
        leafSourceEntryId: 'source-entry-compaction-1',
        updatedAt: '2026-05-31T12:02:00.000Z',
        reason: 'source_appended',
      },
      expectedCurrentLeafSourceEntryId: 'source-entry-message-1',
    });

    expect(result.activeLeafAdvanced).toBe(true);
    expect(repo.getSessionCompaction('compaction-1')).toEqual(compaction);
    expect(activePathRepo.getSourceEntryBySourceRef('session-1', {
      sourceKind: 'session_summary',
      sourceId: 'compaction-1',
    })?.parentSourceEntryId).toBe('source-entry-message-1');
    expect(activePathRepo.getActiveLeaf('session-1')?.leafSourceEntryId).toBe('source-entry-compaction-1');
  });

  it('rolls back session compaction when active path source attribution fails', () => {
    const repo = createRepo();
    const activePathRepo = new SessionActivePathRepository(db!);
    repo.saveSession({
      sessionId: 'session-1',
      title: 'Session',
      status: 'active',
      createdAt: '2026-05-31T12:00:00.000Z',
      updatedAt: '2026-05-31T12:00:00.000Z',
    });
    activePathRepo.appendSourceEntry({
      sourceEntryId: 'source-entry-duplicate',
      sessionId: 'session-1',
      sourceRef: {
        sourceKind: 'session_message',
        sourceId: 'message-1',
        sourceUri: 'session-message://message-1',
        loadedAt: '2026-05-31T12:01:00.000Z',
      },
      createdAt: '2026-05-31T12:01:00.000Z',
    });

    expect(() => repo.saveSessionCompactionWithActivePath({
      compaction: {
        compactionId: 'compaction-rollback',
        sessionId: 'session-1',
        summary: 'This row should roll back.',
        summaryKind: 'compaction',
        firstKeptSourceRef: {
          sourceKind: 'session_message',
          sourceId: 'message-1',
          sourceUri: 'session-message://message-1',
          loadedAt: '2026-05-31T12:01:00.000Z',
        },
        tokensBefore: 9000,
        triggerReason: 'context_budget_pressure',
        status: 'completed',
        createdAt: '2026-05-31T12:02:00.000Z',
      },
      sourceEntry: {
        sourceEntryId: 'source-entry-duplicate',
        sessionId: 'session-1',
        sourceRef: {
          sourceKind: 'session_summary',
          sourceId: 'compaction-rollback',
          sourceUri: 'session-compaction://compaction-rollback',
          loadedAt: '2026-05-31T12:02:00.000Z',
        },
        createdAt: '2026-05-31T12:02:00.000Z',
      },
      activeLeaf: {
        sessionId: 'session-1',
        leafSourceEntryId: 'source-entry-duplicate',
        updatedAt: '2026-05-31T12:02:00.000Z',
        reason: 'source_appended',
      },
    })).toThrow();
    expect(repo.getSessionCompaction('compaction-rollback')).toBeNull();
    expect(activePathRepo.getSourceEntryBySourceRef('session-1', {
      sourceKind: 'session_summary',
      sourceId: 'compaction-rollback',
    })).toBeUndefined();
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
