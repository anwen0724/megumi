/* Verifies released compaction summaries upgrade into recoverable lifecycle records. */
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

describe('session compaction lifecycle migration', () => {
  it('preserves a released summary as a completed legacy compaction', () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-compaction-lifecycle-'));
    const releasedMigrations = path.join(tempRoot, 'migrations');
    fs.mkdirSync(path.join(releasedMigrations, 'meta'), { recursive: true });
    for (const name of fs.readdirSync(migrationsRoot).filter((name) => /^000[0-9]_.*\.sql$/.test(name))) {
      fs.copyFileSync(path.join(migrationsRoot, name), path.join(releasedMigrations, name));
    }
    const journal = JSON.parse(fs.readFileSync(path.join(migrationsRoot, 'meta/_journal.json'), 'utf8')) as {
      entries: unknown[];
    };
    fs.writeFileSync(path.join(releasedMigrations, 'meta/_journal.json'), JSON.stringify({
      ...journal,
      entries: journal.entries.slice(0, 10),
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
          message_id, session_id, message_kind, message_json, created_at, completed_at
        ) VALUES ('M1', 'S1', 'user_message', '{"display_content":[],"model_content":[]}', '2026-01-01', '2026-01-01')
      ` }).run();
      database.prepare({ sql: `
        INSERT INTO session_entries (entry_id, session_id, entry_type, message_id, created_at)
        VALUES ('E1', 'S1', 'message', 'M1', '2026-01-01')
      ` }).run();
      database.prepare({ sql: `
        INSERT INTO session_compactions (
          compaction_id, session_id, summary_text, covered_until_entry_id, created_at
        ) VALUES ('C1', 'S1', 'Summary', 'E1', '2026-01-02')
      ` }).run();
      database.prepare({ sql: `
        INSERT INTO session_entries (entry_id, session_id, entry_type, compaction_id, created_at)
        VALUES ('EC1', 'S1', 'compaction', 'C1', '2026-01-02')
      ` }).run();

      migrateDatabase({ database, migrationsFolder: migrationsRoot });

      expect(database.prepare<Record<string, unknown>>({
        sql: "SELECT * FROM session_compactions WHERE compaction_id = 'C1'",
      }).get()).toMatchObject({
        anchor_entry_id: 'E1',
        trigger: 'legacy',
        status: 'completed',
        started_at: '2026-01-02',
        completed_at: '2026-01-02',
      });
      expect(database.prepare<{ compaction_id: string }>({
        sql: "SELECT compaction_id FROM session_entries WHERE entry_id = 'EC1'",
      }).get()).toEqual({ compaction_id: 'C1' });
      expect(database.prepare({ sql: 'PRAGMA foreign_key_check' }).all()).toEqual([]);
    } finally {
      database.close();
    }
  });
});
