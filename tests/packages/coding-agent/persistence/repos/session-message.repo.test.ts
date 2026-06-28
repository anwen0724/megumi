// @vitest-environment node
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '@megumi/coding-agent/persistence/schema/migrations';
import { SessionMessageRepository } from '@megumi/coding-agent/persistence/repos/session-message.repo';
import { SessionRecordRepository } from '@megumi/coding-agent/persistence/repos/session-record.repo';

let db: Database.Database | null = null;

function createRepositories(): {
  sessionMessageRepository: SessionMessageRepository;
  sessionRecordRepository: SessionRecordRepository;
} {
  db = new Database(':memory:');
  migrateDatabase(db);
  return {
    sessionMessageRepository: new SessionMessageRepository(db),
    sessionRecordRepository: new SessionRecordRepository(db),
  };
}

afterEach(() => {
  db?.close();
  db = null;
});

describe('SessionMessageRepository', () => {
  it('saves, updates, gets, and lists session messages in creation order', () => {
    const { sessionMessageRepository, sessionRecordRepository } = createRepositories();
    sessionRecordRepository.saveSession({
      sessionId: 'session-1',
      title: 'Session',
      status: 'active',
      createdAt: '2026-05-15T00:00:00.000Z',
      updatedAt: '2026-05-15T00:00:00.000Z',
    });

    sessionMessageRepository.saveMessage({
      messageId: 'message-2',
      sessionId: 'session-1',
      role: 'assistant',
      content: 'Second',
      status: 'completed',
      createdAt: '2026-05-15T00:00:02.000Z',
      completedAt: '2026-05-15T00:00:03.000Z',
      metadata: { source: 'model' },
    });
    sessionMessageRepository.saveMessage({
      messageId: 'message-1',
      sessionId: 'session-1',
      runId: 'run-1',
      role: 'user',
      content: 'First',
      status: 'completed',
      createdAt: '2026-05-15T00:00:01.000Z',
    });

    const updated = sessionMessageRepository.saveMessage({
      messageId: 'message-1',
      sessionId: 'session-1',
      runId: 'run-1',
      role: 'user',
      content: 'First updated',
      status: 'completed',
      createdAt: '2026-05-15T00:00:01.000Z',
      completedAt: '2026-05-15T00:00:01.500Z',
      metadata: { edited: true },
    });

    expect(updated.content).toBe('First updated');
    expect(sessionMessageRepository.getMessage('message-1')).toEqual(updated);
    expect(sessionMessageRepository.getMessage('missing-message')).toBeUndefined();
    expect(sessionMessageRepository.listMessagesBySession('session-1')).toEqual([
      updated,
      expect.objectContaining({ messageId: 'message-2', metadata: { source: 'model' } }),
    ]);
  });
});
