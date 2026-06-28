// @vitest-environment node
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '@megumi/coding-agent/persistence/schema/migrations';
import { SessionRecordRepository } from '@megumi/coding-agent/persistence/repos/session-record.repo';

let db: Database.Database | null = null;

function createRepository(): SessionRecordRepository {
  db = new Database(':memory:');
  migrateDatabase(db);
  return new SessionRecordRepository(db);
}

afterEach(() => {
  db?.close();
  db = null;
});

describe('SessionRecordRepository', () => {
  it('saves, updates, gets, and lists sessions by update time', () => {
    const repository = createRepository();

    repository.saveSession({
      sessionId: 'session-older',
      title: 'Older',
      status: 'active',
      createdAt: '2026-05-15T00:00:00.000Z',
      updatedAt: '2026-05-15T00:00:00.000Z',
    });
    repository.saveSession({
      sessionId: 'session-newer',
      title: 'Newer',
      workspaceId: 'workspace-1',
      workspacePath: 'C:/workspace',
      status: 'active',
      createdAt: '2026-05-15T00:00:01.000Z',
      updatedAt: '2026-05-15T00:00:01.000Z',
      summary: 'Summary',
      metadata: { pinned: true },
    });

    const updated = repository.saveSession({
      sessionId: 'session-older',
      title: 'Older updated',
      status: 'archived',
      createdAt: '2026-05-15T00:00:00.000Z',
      updatedAt: '2026-05-15T00:00:02.000Z',
      archivedAt: '2026-05-15T00:00:03.000Z',
    });

    expect(repository.getSession('session-older')).toEqual(updated);
    expect(repository.getSession('missing-session')).toBeUndefined();
    expect(repository.listSessions()).toEqual([
      updated,
      expect.objectContaining({
        sessionId: 'session-newer',
        workspaceId: 'workspace-1',
        workspacePath: 'C:/workspace',
        summary: 'Summary',
        metadata: { pinned: true },
      }),
    ]);
  });
});
