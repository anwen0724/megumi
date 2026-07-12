import { describe, expect, it } from 'vitest';

import { createDatabase } from '@megumi/coding-agent/persistence/connection';
import { applyCodingAgentDatabaseMigrations } from '@megumi/coding-agent/persistence/schema/migrate';
import type {
  WorkspaceChangedFile,
  WorkspaceChangeSet,
} from '@megumi/coding-agent/workspace';
import { WorkspaceChangeRepository } from '@megumi/coding-agent/workspace/repositories/workspace-change-repository';

function createTestRepository() {
  const database = createDatabase(':memory:');
  applyCodingAgentDatabaseMigrations(database);
  database.prepare(`
    INSERT INTO workspaces (
      workspace_id, name, root_path, root_path_key, status,
      created_at, updated_at, last_opened_at
    ) VALUES (
      'workspace:one', 'One', 'C:/work/one', 'c:/work/one', 'available',
      '2026-05-16T00:00:00.000Z', '2026-05-16T00:00:00.000Z', '2026-05-16T00:00:00.000Z'
    )
  `).run();
  database.prepare(`
    INSERT INTO sessions (
      session_id, workspace_id, title, status,
      created_at, updated_at
    ) VALUES (
      'session:one', 'workspace:one', 'Session', 'active',
      '2026-05-16T00:00:00.000Z', '2026-05-16T00:00:00.000Z'
    )
  `).run();
  return new WorkspaceChangeRepository(database);
}

function changeSet(overrides: Partial<WorkspaceChangeSet> = {}): WorkspaceChangeSet {
  return {
    change_set_id: 'change-set:one',
    workspace_id: 'workspace:one',
    session_id: 'session:one',
    run_id: 'run:one',
    status: 'open',
    changed_file_count: 0,
    created_at: '2026-05-16T00:00:00.000Z',
    ...overrides,
  };
}

function changedFile(overrides: Partial<WorkspaceChangedFile> = {}): WorkspaceChangedFile {
  return {
    changed_file_id: 'changed-file:one',
    change_set_id: 'change-set:one',
    workspace_path: 'src/index.ts',
    change_kind: 'created',
    created_at: '2026-05-16T00:00:01.000Z',
    ...overrides,
  };
}

describe('WorkspaceChangeRepository', () => {
  it('inserts an open change set and finds it by scope', () => {
    const repository = createTestRepository();

    expect(repository.insertChangeSet(changeSet())).toEqual(changeSet());
    expect(repository.findOpenChangeSet({
      workspace_id: 'workspace:one',
      session_id: 'session:one',
      run_id: 'run:one',
    })).toEqual(changeSet());
  });

  it('finalizes a change set with the derived changed file count', () => {
    const repository = createTestRepository();
    repository.insertChangeSet(changeSet());
    repository.insertOrUpdateChangedFile(changedFile());

    expect(repository.finalizeChangeSet({
      change_set_id: 'change-set:one',
      finalized_at: '2026-05-16T00:01:00.000Z',
    })).toEqual({
      ...changeSet({
        status: 'finalized',
        changed_file_count: 1,
        finalized_at: '2026-05-16T00:01:00.000Z',
      }),
    });
  });

  it('upserts changed files by change set and workspace path', () => {
    const repository = createTestRepository();
    repository.insertChangeSet(changeSet());

    expect(repository.insertOrUpdateChangedFile(changedFile())).toEqual(changedFile());
    expect(repository.insertOrUpdateChangedFile(changedFile({
      changed_file_id: 'changed-file:other',
      change_kind: 'modified',
      created_at: '2026-05-16T00:00:02.000Z',
    }))).toEqual(changedFile({
      change_kind: 'modified',
    }));
    expect(repository.listChangedFilesByChangeSetId('change-set:one')).toEqual([
      changedFile({ change_kind: 'modified' }),
    ]);
    expect(repository.findChangeSetById('change-set:one')).toMatchObject({
      changed_file_count: 1,
    });
  });

  it('returns summaries and changed files joined by run id', () => {
    const repository = createTestRepository();
    repository.insertChangeSet(changeSet());
    repository.insertOrUpdateChangedFile(changedFile());

    expect(repository.getChangeSummary('change-set:one')).toEqual({
      change_set: changeSet({ changed_file_count: 1 }),
      files: [changedFile()],
    });
    expect(repository.listChangedFilesByRunId('run:one')).toEqual([changedFile()]);
    expect(repository.getChangeSummary('change-set:missing')).toBeUndefined();
  });
});
