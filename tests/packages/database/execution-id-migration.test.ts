/* Verifies the 0011 execution_id migration preserves correlation data and is a no-op when repeated. */
// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase } from '../../../packages/agent/database/src';

const migrationsRoot = path.join(process.cwd(), 'packages/agent/database/migrations');
let tempRoot: string | undefined;

afterEach(() => {
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = undefined;
});

describe('execution_id migration', () => {
  it('renames Session Message and Workspace Change run_id into execution_id without losing data', () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-execution-id-'));
    const releasedMigrations = path.join(tempRoot, 'migrations');
    fs.mkdirSync(path.join(releasedMigrations, 'meta'), { recursive: true });
    for (const name of fs.readdirSync(migrationsRoot).filter(
      (name) => /^[0-9]{4}_.*\.sql$/.test(name) && name.localeCompare('0011_execution_id.sql') < 0,
    )) {
      fs.copyFileSync(path.join(migrationsRoot, name), path.join(releasedMigrations, name));
    }
    const journal = JSON.parse(fs.readFileSync(path.join(migrationsRoot, 'meta/_journal.json'), 'utf8')) as {
      entries: unknown[];
    };
    fs.writeFileSync(path.join(releasedMigrations, 'meta/_journal.json'), JSON.stringify({
      ...journal,
      entries: journal.entries.slice(0, 11),
    }));

    const database = createDatabase({ filename: path.join(tempRoot, 'megumi.sqlite3') });
    try {
      migrateDatabase({ database, migrationsFolder: releasedMigrations });
      database.prepare({ sql: `
        INSERT INTO workspaces (
          workspace_id, name, root_path, root_path_key, status, created_at, updated_at, last_opened_at
        ) VALUES ('W1', 'Workspace', '/workspace', '/workspace', 'available', '2026-01-01', '2026-01-01', '2026-01-01')
      ` }).run();
      database.prepare({ sql: `
        INSERT INTO sessions (session_id, workspace_id, title, status, created_at, updated_at)
        VALUES ('S1', 'W1', 'Session', 'active', '2026-01-01', '2026-01-01')
      ` }).run();
      database.prepare({ sql: `
        INSERT INTO session_messages (
          message_id, session_id, run_id, message_kind, message_json, created_at
        ) VALUES ('M1', 'S1', 'run:legacy-1', 'user_message', '{"display_content":[],"model_content":[]}', '2026-01-01')
      ` }).run();
      database.prepare({ sql: `
        INSERT INTO workspace_changes (
          change_set_id, workspace_id, session_id, run_id, status, effect_coverage, changed_file_count, created_at
        ) VALUES ('C1', 'W1', 'S1', 'run:legacy-1', 'open', 'full', 0, '2026-01-01')
      ` }).run();

      migrateDatabase({ database, migrationsFolder: migrationsRoot });

      expect(database.prepare<Record<string, unknown>>({
        sql: "SELECT * FROM session_messages WHERE message_id = 'M1'",
      }).get()).toMatchObject({
        message_id: 'M1',
        session_id: 'S1',
        execution_id: 'run:legacy-1',
      });
      expect(database.prepare<Record<string, unknown>>({
        sql: "SELECT * FROM workspace_changes WHERE change_set_id = 'C1'",
      }).get()).toMatchObject({
        change_set_id: 'C1',
        execution_id: 'run:legacy-1',
      });
      const messageColumns = database.prepare<{ name: string }>({
        sql: 'PRAGMA table_info(session_messages)',
      }).all().map((row) => row.name);
      expect(messageColumns).toEqual([
        'message_id', 'session_id', 'execution_id', 'message_kind', 'message_json', 'created_at', 'completed_at',
      ]);
      expect(messageColumns).not.toContain('run_id');
      const changeColumns = database.prepare<{ name: string }>({
        sql: 'PRAGMA table_info(workspace_changes)',
      }).all().map((row) => row.name);
      expect(changeColumns).toContain('execution_id');
      expect(changeColumns).not.toContain('run_id');
      expect(database.prepare({ sql: 'PRAGMA foreign_key_check' }).all()).toEqual([]);
    } finally {
      database.close();
    }
  });

  it('is a no-op when the migration is applied twice', () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-execution-id-idempotent-'));
    const database = createDatabase({ filename: path.join(tempRoot, 'megumi.sqlite3') });
    try {
      migrateDatabase({ database, migrationsFolder: migrationsRoot });
      migrateDatabase({ database, migrationsFolder: migrationsRoot });
      expect(database.prepare<{ name: string }>({
        sql: 'PRAGMA table_info(session_messages)',
      }).all().map((row) => row.name)).toContain('execution_id');
      expect(database.prepare({ sql: 'PRAGMA foreign_key_check' }).all()).toEqual([]);
    } finally {
      database.close();
    }
  });
});
