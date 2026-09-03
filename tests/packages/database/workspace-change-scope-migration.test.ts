/* Verifies one Workspace ChangeSet identity is retained for each execution scope. */
// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createDatabase,
  migrateDatabase,
  type DatabaseConnection,
} from '../../../packages/agent/database/src';

const migrationsRoot = path.join(process.cwd(), 'packages/agent/database/migrations');
let tempRoot: string | undefined;

afterEach(() => {
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = undefined;
});

describe('Workspace ChangeSet scope migration', () => {
  it('rejects two ChangeSets for the same Workspace, Session, and Execution', () => {
    const database = createMigratedDatabase();
    try {
      seedWorkspaceSessions(database);
      insertChangeSet(database, { changeSetId: 'change:1' });

      expect(() => insertChangeSet(database, {
        changeSetId: 'change:duplicate',
      })).toThrow();
    } finally {
      database.close();
    }
  });

  it('allows ChangeSets for different execution scopes', () => {
    const database = createMigratedDatabase();
    try {
      seedWorkspaceSessions(database);
      insertChangeSet(database, { changeSetId: 'change:1' });
      insertChangeSet(database, {
        changeSetId: 'change:execution-2',
        executionId: 'execution:2',
      });
      insertChangeSet(database, {
        changeSetId: 'change:session-2',
        sessionId: 'session:2',
      });

      expect(database.prepare<{ change_set_id: string }>({ sql: `
        SELECT change_set_id FROM workspace_changes
        ORDER BY change_set_id
      ` }).all()).toEqual([
        { change_set_id: 'change:1' },
        { change_set_id: 'change:execution-2' },
        { change_set_id: 'change:session-2' },
      ]);
    } finally {
      database.close();
    }
  });

  it('fails an upgrade with duplicate scopes without rewriting existing facts', () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-workspace-change-scope-'));
    const releasedMigrations = path.join(tempRoot, 'released-migrations');
    copyMigrationsBeforeScopeConstraint(releasedMigrations);
    const database = createDatabase({ filename: path.join(tempRoot, 'megumi.sqlite3') });

    try {
      migrateDatabase({ database, migrationsFolder: releasedMigrations });
      seedWorkspaceSessions(database);
      insertChangeSet(database, { changeSetId: 'change:1' });
      insertChangeSet(database, { changeSetId: 'change:duplicate' });
      insertChangedFile(database, 'file:1', 'change:1', 'src/one.ts');
      insertChangedFile(database, 'file:duplicate', 'change:duplicate', 'src/two.ts');

      let failure: unknown;
      try {
        migrateDatabase({ database, migrationsFolder: migrationsRoot });
      } catch (error) {
        failure = error;
      }

      expect(failure).toMatchObject({
        name: 'DatabaseMigrationError',
        migration: '0019_workspace_change_scope',
        reason: 'sql_migration_failed',
      });
      expect(database.prepare<{ change_set_id: string }>({ sql: `
        SELECT change_set_id FROM workspace_changes
        ORDER BY change_set_id
      ` }).all()).toEqual([
        { change_set_id: 'change:1' },
        { change_set_id: 'change:duplicate' },
      ]);
      expect(database.prepare<{ changed_file_id: string }>({ sql: `
        SELECT changed_file_id FROM workspace_changed_files
        ORDER BY changed_file_id
      ` }).all()).toEqual([
        { changed_file_id: 'file:1' },
        { changed_file_id: 'file:duplicate' },
      ]);
    } finally {
      database.close();
    }
  });
});

function createMigratedDatabase(): DatabaseConnection {
  const database = createDatabase({ filename: ':memory:' });
  migrateDatabase({ database, migrationsFolder: migrationsRoot });
  return database;
}

function copyMigrationsBeforeScopeConstraint(target: string): void {
  fs.mkdirSync(path.join(target, 'meta'), { recursive: true });
  const journal = JSON.parse(fs.readFileSync(path.join(migrationsRoot, 'meta/_journal.json'), 'utf8')) as {
    entries: Array<{ readonly idx: number; readonly tag: string }>;
  };
  const releasedEntries = journal.entries.filter((entry) => entry.idx < 19);
  for (const entry of releasedEntries) {
    fs.copyFileSync(
      path.join(migrationsRoot, `${entry.tag}.sql`),
      path.join(target, `${entry.tag}.sql`),
    );
  }
  fs.writeFileSync(path.join(target, 'meta/_journal.json'), JSON.stringify({
    ...journal,
    entries: releasedEntries,
  }));
}

function seedWorkspaceSessions(database: DatabaseConnection): void {
  database.prepare({ sql: `
    INSERT INTO workspaces (
      workspace_id, name, root_path, root_path_key, status,
      created_at, updated_at, last_opened_at
    ) VALUES (
      'workspace:1', 'Workspace', '/workspace', '/workspace', 'available',
      '2026-09-03T00:00:00.000Z', '2026-09-03T00:00:00.000Z', '2026-09-03T00:00:00.000Z'
    )
  ` }).run();
  for (const sessionId of ['session:1', 'session:2']) {
    database.prepare({ sql: `
      INSERT INTO sessions (
        session_id, workspace_id, title, status, created_at, updated_at
      ) VALUES (?, 'workspace:1', 'Session', 'active', ?, ?)
    ` }).run([
      sessionId,
      '2026-09-03T00:00:00.000Z',
      '2026-09-03T00:00:00.000Z',
    ]);
  }
}

function insertChangeSet(database: DatabaseConnection, input: {
  readonly changeSetId: string;
  readonly sessionId?: string;
  readonly executionId?: string;
}): void {
  database.prepare({ sql: `
    INSERT INTO workspace_changes (
      change_set_id, workspace_id, session_id, execution_id, status,
      effect_coverage, changed_file_count, created_at
    ) VALUES (?, 'workspace:1', ?, ?, 'open', 'complete', 0, ?)
  ` }).run([
    input.changeSetId,
    input.sessionId ?? 'session:1',
    input.executionId ?? 'execution:1',
    '2026-09-03T00:01:00.000Z',
  ]);
}

function insertChangedFile(
  database: DatabaseConnection,
  changedFileId: string,
  changeSetId: string,
  workspacePath: string,
): void {
  database.prepare({ sql: `
    INSERT INTO workspace_changed_files (
      changed_file_id, change_set_id, workspace_path, change_kind,
      effect_type, path_type, created_at
    ) VALUES (?, ?, ?, 'created', 'created', 'file', ?)
  ` }).run([
    changedFileId,
    changeSetId,
    workspacePath,
    '2026-09-03T00:02:00.000Z',
  ]);
}
