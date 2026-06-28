// @vitest-environment node
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '@megumi/coding-agent/persistence/schema/migrations';
import { SessionCompactionRepository } from '@megumi/coding-agent/persistence/repos/session-compaction.repo';
import { SessionRecordRepository } from '@megumi/coding-agent/persistence/repos/session-record.repo';
import type { SessionCompactionEntry } from '@megumi/shared/session';

let db: Database.Database | null = null;

function createRepositories(): {
  sessionCompactionRepository: SessionCompactionRepository;
  sessionRecordRepository: SessionRecordRepository;
} {
  db = new Database(':memory:');
  migrateDatabase(db);
  return {
    sessionCompactionRepository: new SessionCompactionRepository(db),
    sessionRecordRepository: new SessionRecordRepository(db),
  };
}

afterEach(() => {
  db?.close();
  db = null;
});

describe('SessionCompactionRepository', () => {
  it('saves, updates, gets, and lists session compactions by recency', () => {
    const { sessionCompactionRepository, sessionRecordRepository } = createRepositories();
    sessionRecordRepository.saveSession({
      sessionId: 'session-1',
      title: 'Compaction session',
      status: 'active',
      createdAt: '2026-05-31T10:00:00.000Z',
      updatedAt: '2026-05-31T10:00:00.000Z',
    });

    const first: SessionCompactionEntry = {
      compactionId: 'compaction-1',
      sessionId: 'session-1',
      summary: 'First summary',
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
      metadata: { summarizedSourceCount: 2 },
    };
    const second: SessionCompactionEntry = {
      ...first,
      compactionId: 'compaction-2',
      summary: 'Second summary',
      firstKeptSourceRef: {
        sourceId: 'message-6',
        sourceKind: 'session_message',
        loadedAt: '2026-05-31T10:10:00.000Z',
      },
      tokensBefore: 190000,
      createdAt: '2026-05-31T10:15:00.000Z',
      metadata: { previousCompactionId: 'compaction-1', summarizedSourceCount: 3 },
    };

    sessionCompactionRepository.saveSessionCompaction(first);
    sessionCompactionRepository.saveSessionCompaction(second);

    const updatedFirst: SessionCompactionEntry = {
      ...first,
      summary: 'First summary updated',
      metadata: { summarizedSourceCount: 4 },
    };
    sessionCompactionRepository.saveSessionCompaction(updatedFirst);

    expect(sessionCompactionRepository.getSessionCompaction('compaction-1')).toEqual(updatedFirst);
    expect(sessionCompactionRepository.listSessionCompactionsBySession('session-1')).toEqual([
      second,
      updatedFirst,
    ]);
    expect(sessionCompactionRepository.getLatestCompletedSessionCompaction('session-1')).toEqual(second);
    expect(sessionCompactionRepository.getSessionCompaction('missing-compaction')).toBeNull();
    expect(sessionCompactionRepository.getLatestCompletedSessionCompaction('missing-session')).toBeNull();
  });
});
