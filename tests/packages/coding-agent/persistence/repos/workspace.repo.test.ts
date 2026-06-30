// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createDatabase } from '@megumi/coding-agent/persistence/connection';
import { applyCodingAgentDatabaseMigrations } from '@megumi/coding-agent/persistence/schema/migrate';
import { WorkspaceRepository, createProjectIdFromRepoPathKey, toProjectRepoPathKey } from '@megumi/coding-agent/persistence/repos/workspace.repo';

function createTestDatabase() {
  const database = createDatabase(':memory:');
  applyCodingAgentDatabaseMigrations(database);
  return database;
}

describe('WorkspaceRepository', () => {
  it('normalizes repo path keys for stable de-dupe', () => {
    expect(toProjectRepoPathKey('C:/Work/Megumi', 'win32')).toBe(toProjectRepoPathKey('c:/work/megumi', 'win32'));
    expect(toProjectRepoPathKey('/Users/anwen/Megumi', 'darwin')).toBe('/Users/anwen/Megumi');
  });

  it('creates stable project ids from repo path keys', () => {
    const key = toProjectRepoPathKey('C:/Work/Megumi', 'win32');

    expect(createProjectIdFromRepoPathKey(key)).toMatch(/^project:[a-f0-9]{16}$/);
    expect(createProjectIdFromRepoPathKey(key)).toBe(createProjectIdFromRepoPathKey(key));
  });

  it('upserts projects by repo path key and refreshes lastOpenedAt', () => {
    const database = createTestDatabase();
    const repo = new WorkspaceRepository(database);

    const first = repo.upsertFromRepoPath({
      repoPath: 'C:/Work/Megumi',
      now: '2026-05-19T00:00:00.000Z',
      platform: 'win32',
    });
    const second = repo.upsertFromRepoPath({
      repoPath: 'c:/work/megumi',
      now: '2026-05-19T00:00:10.000Z',
      platform: 'win32',
    });

    expect(second.projectId).toBe(first.projectId);
    expect(second.name).toBe('megumi');
    expect(second.lastOpenedAt).toBe('2026-05-19T00:00:10.000Z');
    expect(repo.listProjects().map((project) => project.projectId)).toEqual([first.projectId]);
  });

  it('upserts workspaces by root path through the aggregate repository name', () => {
    const database = createTestDatabase();
    const repo = new WorkspaceRepository(database);

    const workspace = repo.upsertFromRootPath({
      rootPath: 'C:/Work/Megumi',
      now: '2026-06-30T00:00:00.000Z',
      platform: 'win32',
    });

    expect(workspace.projectId).toMatch(/^project:[a-f0-9]{16}$/);
    expect(database.prepare('SELECT root_path FROM workspaces WHERE workspace_id = ?').get(workspace.projectId)).toEqual({
      root_path: workspace.repoPath,
    });
  });

  it('lists projects by last opened time descending', () => {
    const database = createTestDatabase();
    const repo = new WorkspaceRepository(database);

    repo.upsertFromRepoPath({
      repoPath: 'C:/Work/Older',
      now: '2026-05-19T00:00:00.000Z',
      platform: 'win32',
    });
    repo.upsertFromRepoPath({
      repoPath: 'C:/Work/Newer',
      now: '2026-05-19T00:00:10.000Z',
      platform: 'win32',
    });

    expect(repo.listProjects().map((project) => project.name)).toEqual(['Newer', 'Older']);
  });

  it('updates status and removes project records without touching sessions', () => {
    const database = createTestDatabase();
    const repo = new WorkspaceRepository(database);
    const project = repo.upsertFromRepoPath({
      repoPath: 'C:/Work/Missing',
      now: '2026-05-19T00:00:00.000Z',
      platform: 'win32',
    });

    expect(repo.updateStatus(project.projectId, 'missing')?.status).toBe('missing');
    expect(repo.removeProject(project.projectId)).toBe(true);
    expect(repo.getProject(project.projectId)).toBeUndefined();
  });
});

