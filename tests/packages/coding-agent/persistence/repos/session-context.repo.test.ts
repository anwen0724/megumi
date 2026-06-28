// @vitest-environment node
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '@megumi/coding-agent/persistence/schema/migrations';
import { SessionActivePathRepository } from '@megumi/coding-agent/persistence/repos/session-active-path.repo';
import { SessionContextRepository } from '@megumi/coding-agent/persistence/repos/session-context.repo';
import { SessionRunRepository } from '@megumi/coding-agent/persistence/repos/session-run.repo';
import type { SessionCompactionEntry } from '@megumi/shared/session';

let db: Database.Database | null = null;

function createRepositories(): {
  activePathRepository: SessionActivePathRepository;
  sessionContextRepository: SessionContextRepository;
  sessionRunRepository: SessionRunRepository;
} {
  db = new Database(':memory:');
  migrateDatabase(db);
  return {
    activePathRepository: new SessionActivePathRepository(db),
    sessionContextRepository: new SessionContextRepository(db),
    sessionRunRepository: new SessionRunRepository(db),
  };
}

afterEach(() => {
  db?.close();
  db = null;
});

describe('SessionContextRepository', () => {
  it('atomically saves a compaction source entry and advances the active leaf when expected leaf matches', () => {
    const { activePathRepository, sessionContextRepository, sessionRunRepository } = createRepositories();
    sessionRunRepository.saveSession({
      sessionId: 'session-1',
      title: 'Session',
      status: 'active',
      createdAt: '2026-05-31T12:00:00.000Z',
      updatedAt: '2026-05-31T12:00:00.000Z',
    });
    activePathRepository.appendSourceEntryAndSetActiveLeaf({
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

    const result = sessionContextRepository.saveSessionCompactionWithActivePath({
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
    expect(sessionContextRepository.getSessionCompaction('compaction-1')).toEqual(compaction);
    expect(activePathRepository.getSourceEntryBySourceRef('session-1', {
      sourceKind: 'session_summary',
      sourceId: 'compaction-1',
    })?.parentSourceEntryId).toBe('source-entry-message-1');
    expect(activePathRepository.getActiveLeaf('session-1')?.leafSourceEntryId).toBe('source-entry-compaction-1');
  });

  it('rolls back the compaction when source attribution fails', () => {
    const { activePathRepository, sessionContextRepository, sessionRunRepository } = createRepositories();
    sessionRunRepository.saveSession({
      sessionId: 'session-1',
      title: 'Session',
      status: 'active',
      createdAt: '2026-05-31T12:00:00.000Z',
      updatedAt: '2026-05-31T12:00:00.000Z',
    });
    activePathRepository.appendSourceEntry({
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

    expect(() => sessionContextRepository.saveSessionCompactionWithActivePath({
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

    expect(sessionContextRepository.getSessionCompaction('compaction-rollback')).toBeNull();
    expect(activePathRepository.getSourceEntryBySourceRef('session-1', {
      sourceKind: 'session_summary',
      sourceId: 'compaction-rollback',
    })).toBeUndefined();
  });
});
