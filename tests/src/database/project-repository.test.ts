// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { openSqliteDatabase, runDatabaseMigrations, SqliteProjectRepository } from '../../../src/database';

describe('SqliteProjectRepository', () => {
  it('upserts, lists, touches, updates status, and removes projects', () => {
    const database = openSqliteDatabase(':memory:');
    runDatabaseMigrations(database, { now: () => '2026-06-19T00:00:00.000Z' });
    const repository = new SqliteProjectRepository(database);

    const project = repository.upsertFromPath({
      path: 'C:/all/work/study/megumi',
      name: 'megumi',
      now: '2026-06-19T00:00:00.000Z',
      status: 'available',
    });

    expect(repository.listProjects()).toEqual([project]);
    expect(repository.touchProject(project.id, '2026-06-19T00:01:00.000Z')).toMatchObject({
      id: project.id,
      lastOpenedAt: '2026-06-19T00:01:00.000Z',
    });
    expect(repository.updateStatus(project.id, 'missing')).toMatchObject({ status: 'missing' });
    expect(repository.removeProject(project.id)).toBe(true);
    expect(repository.listProjects()).toEqual([]);

    database.close();
  });
});
