/* Verifies every released migration prefix upgrades to the same final schema without data loss. */
// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createDatabase,
  databaseTables,
  migrateDatabase,
  type DatabaseConnection,
} from '../../../packages/database/src';

const migrationsRoot = path.join(process.cwd(), 'packages/database/migrations');
let tempRoot: string | undefined;

afterEach(() => {
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = undefined;
});

describe('released Database migration fixture matrix', () => {
  for (const releaseVersion of [0, 1, 2, 3, 4, 5, 6] as const) {
    it(`upgrades populated release 000${releaseVersion} without losing durable facts`, () => {
      tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `megumi-database-000${releaseVersion}-`));
      const releaseMigrations = path.join(tempRoot, 'migrations');
      copyMigrationPrefix(releaseMigrations, releaseVersion);
      const database = createDatabase({ filename: path.join(tempRoot, 'megumi.sqlite3') });

      try {
        migrateDatabase({ database, migrationsFolder: releaseMigrations });
        seedReleaseFacts(database, releaseVersion);
        const result = migrateDatabase({ database, migrationsFolder: migrationsRoot });

        expect(result.currentMigration).toBe('0010_session_compaction_lifecycle');
        expect(appTableNames(database)).toEqual([...databaseTables].sort());
        expect(database.prepare<{ name: string }>({
          sql: "SELECT name FROM workspaces WHERE workspace_id = 'workspace:fixture'",
        }).get()).toEqual({ name: 'Fixture Workspace' });
        expect(database.prepare<{ title: string; active_entry_id: string }>({
          sql: "SELECT title, active_entry_id FROM sessions WHERE session_id = 'session:fixture'",
        }).get()).toEqual({ title: 'Fixture Session', active_entry_id: 'entry:fixture' });
        expect(database.prepare<{ message_kind: string }>({
          sql: "SELECT message_kind FROM session_messages WHERE message_id = 'message:fixture'",
        }).get()).toEqual({ message_kind: 'user_message' });
        expect(database.prepare<{ source_value: string; ordinal: number }>({
          sql: "SELECT source_value, ordinal FROM session_message_attachments WHERE attachment_id = 'attachment:fixture'",
        }).get()).toEqual({ source_value: 'fixture.png', ordinal: 0 });
        expect(database.prepare<{ workspace_path: string }>({ sql: `
          SELECT file.workspace_path FROM workspace_changed_files file
          JOIN workspace_changes change ON change.change_set_id = file.change_set_id
          WHERE change.change_set_id = 'change:fixture'
        ` }).get()).toEqual({ workspace_path: 'src/fixture.ts' });
        if (releaseVersion >= 5) {
          expect(database.prepare<{ available: number }>({
            sql: "SELECT available FROM skill_availability WHERE skill_path = 'skills/fixture/SKILL.md'",
          }).get()).toEqual({ available: 1 });
        }
        expect(database.prepare({ sql: 'PRAGMA foreign_key_check' }).all()).toEqual([]);
      } finally {
        database.close();
      }
    });
  }
});

function copyMigrationPrefix(target: string, releaseVersion: number): void {
  fs.mkdirSync(path.join(target, 'meta'), { recursive: true });
  const names = fs.readdirSync(migrationsRoot)
    .filter((name) => /^\d{4}_.*\.sql$/.test(name))
    .sort()
    .slice(0, releaseVersion + 1);
  for (const name of names) fs.copyFileSync(path.join(migrationsRoot, name), path.join(target, name));
  const journal = JSON.parse(fs.readFileSync(path.join(migrationsRoot, 'meta/_journal.json'), 'utf8')) as {
    entries: unknown[];
  };
  fs.writeFileSync(path.join(target, 'meta/_journal.json'), JSON.stringify({
    ...journal,
    entries: journal.entries.slice(0, releaseVersion + 1),
  }));
}

function seedReleaseFacts(database: DatabaseConnection, releaseVersion: number): void {
  run(database, `
    INSERT INTO workspaces (
      workspace_id, name, root_path, root_path_key, status, created_at, updated_at, last_opened_at
    ) VALUES (
      'workspace:fixture', 'Fixture Workspace', '/fixture', '/fixture', 'available',
      '2026-01-01', '2026-01-01', '2026-01-01'
    )
  `);
  run(database, `
    INSERT INTO sessions (
      session_id, workspace_id, title, status, active_entry_id, created_at, updated_at, archived_at
    ) VALUES (
      'session:fixture', 'workspace:fixture', 'Fixture Session', 'active', NULL,
      '2026-01-01', '2026-01-01', NULL
    )
  `);

  if (columnExists(database, 'session_messages', 'message_kind')) {
    run(database, `
      INSERT INTO session_messages (
        message_id, session_id, run_id, message_kind, message_json, created_at, completed_at
      ) VALUES (
        'message:fixture', 'session:fixture', 'run:fixture', 'user_message',
        '{"content":[{"type":"text","text":"Fixture"}]}', '2026-01-01', '2026-01-01'
      )
    `);
  } else if (
    columnExists(database, 'session_messages', 'content_text')
    && columnExists(database, 'session_messages', 'message_json')
  ) {
    run(database, `
      INSERT INTO session_messages (
        message_id, session_id, run_id, role, content_text, message_json, created_at, completed_at
      ) VALUES (
        'message:fixture', 'session:fixture', 'run:fixture', 'user', 'Fixture',
        '{"role":"user","content":[{"type":"text","text":"Fixture"}]}', '2026-01-01', '2026-01-01'
      )
    `);
  } else if (columnExists(database, 'session_messages', 'content_text')) {
    run(database, `
      INSERT INTO session_messages (
        message_id, session_id, run_id, role, content_text, created_at, completed_at
      ) VALUES (
        'message:fixture', 'session:fixture', 'run:fixture', 'user', 'Fixture',
        '2026-01-01', '2026-01-01'
      )
    `);
  } else {
    run(database, `
      INSERT INTO session_messages (
        message_id, session_id, run_id, role, message_json, created_at, completed_at
      ) VALUES (
        'message:fixture', 'session:fixture', 'run:fixture', 'user',
        '{"role":"user","content":[{"type":"text","text":"Fixture"}]}', '2026-01-01', '2026-01-01'
      )
    `);
  }

  run(database, `
    INSERT INTO session_entries (
      entry_id, session_id, parent_entry_id, entry_type, message_id, compaction_id, created_at
    ) VALUES (
      'entry:fixture', 'session:fixture', NULL, 'message', 'message:fixture', NULL, '2026-01-01'
    )
  `);
  run(database, "UPDATE sessions SET active_entry_id = 'entry:fixture' WHERE session_id = 'session:fixture'");

  if (tableExists(database, 'agent_runs')) {
    run(database, `
      INSERT INTO agent_runs (
        run_id, workspace_id, session_id, provider_id, model_id, trigger_type,
        trigger_user_message_id, trigger_command_name, status, created_at, started_at, completed_at, failure_json
      ) VALUES (
        'run:fixture', 'workspace:fixture', 'session:fixture', 'provider', 'model', 'user_input',
        'message:fixture', NULL, 'completed', '2026-01-01', '2026-01-01', '2026-01-01', NULL
      )
    `);
  }
  run(database, `
    INSERT INTO session_message_attachments (
      attachment_id, message_id, session_id, type, name, mime_type, source_type, source_value, created_at
    ) VALUES (
      'attachment:fixture', 'message:fixture', 'session:fixture', 'image', 'Fixture',
      'image/png', 'managed', 'fixture.png', '2026-01-01'
    )
  `);
  run(database, `
    INSERT INTO workspace_changes (
      change_set_id, workspace_id, session_id, run_id, status, changed_file_count, created_at, finalized_at
    ) VALUES (
      'change:fixture', 'workspace:fixture', 'session:fixture', 'run:fixture', 'completed', 1,
      '2026-01-01', '2026-01-01'
    )
  `);
  run(database, `
    INSERT INTO workspace_changed_files (
      changed_file_id, change_set_id, workspace_path, change_kind, created_at
    ) VALUES ('changed-file:fixture', 'change:fixture', 'src/fixture.ts', 'modified', '2026-01-01')
  `);
  if (releaseVersion >= 5) {
    run(database, `
      INSERT INTO skill_availability (skill_availability_id, skill_path, available, updated_at)
      VALUES ('skill-availability:fixture', 'skills/fixture/SKILL.md', 1, '2026-01-01')
    `);
  }
}

function run(database: DatabaseConnection, sql: string): void {
  database.prepare({ sql }).run();
}

function tableExists(database: DatabaseConnection, table: string): boolean {
  return Boolean(database.prepare({
    sql: "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
  }).get([table]));
}

function columnExists(database: DatabaseConnection, table: string, column: string): boolean {
  return database.prepare<{ name: string }>({ sql: `PRAGMA table_info(${table})` }).all()
    .some((entry) => entry.name === column);
}

function appTableNames(database: DatabaseConnection): string[] {
  return database.prepare<{ name: string }>({ sql: `
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle_%'
    ORDER BY name
  ` }).all().map((entry) => entry.name);
}
