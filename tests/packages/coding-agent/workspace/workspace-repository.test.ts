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

  it('does not delete sessions, runs, or workspace changes when removing a referenced workspace', () => {
    const database = createDatabase(':memory:');
    applyCodingAgentDatabaseMigrations(database);
    try {
      const repository = new WorkspaceRepository(database);
      repository.insertOrUpdateWorkspace(workspace());
      database.prepare(`
        INSERT INTO sessions (
          session_id, workspace_id, title, status, active_entry_id,
          created_at, updated_at, archived_at
        ) VALUES (
          'session:one', 'workspace:one', 'Session', 'active', NULL,
          '2026-05-16T00:00:00.000Z', '2026-05-16T00:00:00.000Z', NULL
        )
      `).run();
      database.prepare(`
        INSERT INTO agent_loop_runs (
          run_id, workspace_id, session_id, run_kind, user_message_id, assistant_message_id,
          base_run_id, base_message_id, base_entry_id, attempt_number, status,
          permission_mode, permission_snapshot_json, memory_recall_trace_id,
          started_at, completed_at, cancelled_at, error_json, created_at, metadata_json
        ) VALUES (
          'run:one', 'workspace:one', 'session:one', 'message', NULL, NULL,
          NULL, NULL, NULL, 1, 'completed',
          'default', NULL, NULL,
          NULL, NULL, NULL, NULL, '2026-05-16T00:00:00.000Z', NULL
        )
      `).run();
      database.prepare(`
        INSERT INTO workspace_changes (
          change_set_id, workspace_id, session_id, run_id, status,
          changed_file_count, created_at, finalized_at
        ) VALUES (
          'change-set:one', 'workspace:one', 'session:one', 'run:one', 'finalized',
          0, '2026-05-16T00:00:00.000Z', '2026-05-16T00:01:00.000Z'
        )
      `).run();

      expect(repository.deleteWorkspace('workspace:one')).toBe(false);
      expect(repository.findWorkspaceById('workspace:one')).toEqual(workspace());
      expect(countRows(database, 'sessions')).toBe(1);
      expect(countRows(database, 'agent_loop_runs')).toBe(1);
      expect(countRows(database, 'workspace_changes')).toBe(1);
    } finally {
      database.close();
    }
  });
});

function countRows(database: ReturnType<typeof createDatabase>, tableName: string): number {
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number };
  return row.count;
}
