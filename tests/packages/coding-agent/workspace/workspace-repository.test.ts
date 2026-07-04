import { describe, expect, it } from 'vitest';

import { createDatabase } from '@megumi/coding-agent/persistence/connection';
import { applyCodingAgentDatabaseMigrations } from '@megumi/coding-agent/persistence/schema/migrate';
import type { Workspace } from '@megumi/coding-agent/workspace';
import { WorkspaceRepository } from '@megumi/coding-agent/workspace/repositories/workspace-repository';

function createTestRepository() {
  const database = createDatabase(':memory:');
  applyCodingAgentDatabaseMigrations(database);
  return new WorkspaceRepository(database);
}

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    workspace_id: 'workspace:one',
    name: 'One',
    root_path: 'C:/work/one',
    root_path_key: 'c:/work/one',
    status: 'available',
    created_at: '2026-05-16T00:00:00.000Z',
    updated_at: '2026-05-16T00:00:00.000Z',
    last_opened_at: '2026-05-16T00:00:00.000Z',
    ...overrides,
  };
}

describe('WorkspaceRepository', () => {
  it('inserts and finds a workspace with target fields', () => {
    const repository = createTestRepository();

    const saved = repository.insertOrUpdateWorkspace(workspace());

    expect(saved).toEqual(workspace());
    expect(repository.findWorkspaceById('workspace:one')).toEqual(workspace());
    expect(repository.findWorkspaceByRootPathKey('c:/work/one')).toEqual(workspace());
  });

  it('updates an existing root path key without duplicating rows', () => {
    const repository = createTestRepository();
    repository.insertOrUpdateWorkspace(workspace());

    const updated = repository.insertOrUpdateWorkspace(workspace({
      workspace_id: 'workspace:other',
      name: 'Renamed',
      updated_at: '2026-05-17T00:00:00.000Z',
      last_opened_at: '2026-05-17T00:00:00.000Z',
    }));

    expect(updated).toMatchObject({
      workspace_id: 'workspace:one',
      name: 'Renamed',
      last_opened_at: '2026-05-17T00:00:00.000Z',
    });
    expect(repository.listWorkspaces()).toHaveLength(1);
  });

  it('returns undefined for a missing workspace', () => {
    const repository = createTestRepository();

    expect(repository.findWorkspaceById('workspace:missing')).toBeUndefined();
  });

  it('lists workspaces by last opened time descending', () => {
    const repository = createTestRepository();
    repository.insertOrUpdateWorkspace(workspace({
      workspace_id: 'workspace:old',
      name: 'Old',
      root_path: 'C:/work/old',
      root_path_key: 'c:/work/old',
      last_opened_at: '2026-05-16T00:00:00.000Z',
    }));
    repository.insertOrUpdateWorkspace(workspace({
      workspace_id: 'workspace:new',
      name: 'New',
      root_path: 'C:/work/new',
      root_path_key: 'c:/work/new',
      last_opened_at: '2026-05-17T00:00:00.000Z',
    }));

    expect(repository.listWorkspaces().map((item) => item.workspace_id)).toEqual([
      'workspace:new',
      'workspace:old',
    ]);
  });

  it('updates status, touches opened time, and deletes workspaces', () => {
    const repository = createTestRepository();
    repository.insertOrUpdateWorkspace(workspace());

    expect(repository.updateWorkspaceStatus({
      workspace_id: 'workspace:one',
      status: 'missing',
      updated_at: '2026-05-17T00:00:00.000Z',
    })).toMatchObject({
      status: 'missing',
      updated_at: '2026-05-17T00:00:00.000Z',
    });
    expect(repository.touchWorkspace({
      workspace_id: 'workspace:one',
      opened_at: '2026-05-18T00:00:00.000Z',
    })).toMatchObject({
      updated_at: '2026-05-18T00:00:00.000Z',
      last_opened_at: '2026-05-18T00:00:00.000Z',
    });
    expect(repository.deleteWorkspace('workspace:missing')).toBe(false);
    expect(repository.deleteWorkspace('workspace:one')).toBe(true);
  });
});
