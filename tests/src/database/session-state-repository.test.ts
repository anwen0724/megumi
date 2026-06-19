// Verifies SQLite persistence for session facts used by renderer history hydration.
import { describe, expect, it } from 'vitest';
import {
  openSqliteDatabase,
  runDatabaseMigrations,
  SqliteSessionStateRepository,
} from '../../../src/database';
import { createSessionStateManager } from '../../../src/session';

function createId(prefix: string, value: string): string {
  return `${prefix}-${value}`;
}

describe('SqliteSessionStateRepository', () => {
  it('persists workspace path with session owner facts', () => {
    const database = openSqliteDatabase(':memory:');
    runDatabaseMigrations(database, { now: () => '2026-06-20T00:00:00.000Z' });
    const repository = new SqliteSessionStateRepository(database);
    const manager = createSessionStateManager({
      repository,
      now: () => '2026-06-20T00:00:00.000Z',
      createId,
    });

    manager.createSession({
      idSeed: '1',
      title: 'Project chat',
      workspaceId: 'workspace-1',
      workspacePath: 'C:/Users/anwen/Desktop/test',
    });

    expect(repository.getSession('session-1')).toMatchObject({
      id: 'session-1',
      workspaceId: 'workspace-1',
      workspacePath: 'C:/Users/anwen/Desktop/test',
    });
    expect(repository.listSessions()).toEqual([
      expect.objectContaining({
        id: 'session-1',
        workspaceId: 'workspace-1',
        workspacePath: 'C:/Users/anwen/Desktop/test',
      }),
    ]);

    database.close();
  });
});
