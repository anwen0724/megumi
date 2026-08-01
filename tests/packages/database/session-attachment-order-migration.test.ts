/* Verifies attachment order is deterministically backfilled by migration 0007. */
// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createDatabase,
  migrateDatabase,
  type DatabaseConnection,
} from '../../../packages/database/src';

const migrationsRoot = path.join(process.cwd(), 'packages/database/migrations');
let tempRoot: string | undefined;

afterEach(() => {
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = undefined;
});

describe('0007 Session attachment order migration', () => {
  it('assigns zero-based ordinals by created_at and attachment_id without losing rows', () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-attachment-order-'));
    const legacyMigrations = path.join(tempRoot, 'migrations-0006');
    copyReleasedMigrationsThrough0006(legacyMigrations);
    const filename = path.join(tempRoot, 'megumi.sqlite3');
    const database = createDatabase({ filename });

    try {
      migrateDatabase({ database, migrationsFolder: legacyMigrations });
      seedAttachmentFixture(database);

      const result = migrateDatabase({ database, migrationsFolder: migrationsRoot });
      expect(result.appliedMigrations).toBe(2);
      expect(result.currentMigration).toBe('0008_workspace_tool_effects');
      expect(database.prepare<{ attachment_id: string; ordinal: number }>({ sql: `
        SELECT attachment_id, ordinal FROM session_message_attachments
        WHERE message_id = 'message:1' ORDER BY ordinal
      ` }).all()).toEqual([
        { attachment_id: 'attachment:a', ordinal: 0 },
        { attachment_id: 'attachment:b', ordinal: 1 },
        { attachment_id: 'attachment:c', ordinal: 2 },
      ]);
      expect(database.prepare<{ count: number }>({
        sql: 'SELECT COUNT(*) AS count FROM session_message_attachments',
      }).get()).toEqual({ count: 4 });
      expect(database.prepare({ sql: 'PRAGMA foreign_key_check' }).all()).toEqual([]);

      expect(migrateDatabase({ database, migrationsFolder: migrationsRoot }).appliedMigrations).toBe(0);
    } finally {
      database.close();
    }
  });
});

function copyReleasedMigrationsThrough0006(target: string): void {
  fs.mkdirSync(path.join(target, 'meta'), { recursive: true });
  const names = fs.readdirSync(migrationsRoot)
    .filter((name) => /^000[0-6]_.*\.sql$/.test(name));
  for (const name of names) fs.copyFileSync(path.join(migrationsRoot, name), path.join(target, name));
  const journal = JSON.parse(fs.readFileSync(path.join(migrationsRoot, 'meta/_journal.json'), 'utf8')) as {
    entries: unknown[];
  };
  fs.writeFileSync(path.join(target, 'meta/_journal.json'), JSON.stringify({
    ...journal,
    entries: journal.entries.slice(0, 7),
  }));
}

function seedAttachmentFixture(database: DatabaseConnection): void {
  database.prepare({ sql: `
    INSERT INTO workspaces (
      workspace_id, name, root_path, root_path_key, status, created_at, updated_at, last_opened_at
    ) VALUES ('workspace:1', 'Workspace', '/workspace', '/workspace', 'available', '2026-01-01', '2026-01-01', '2026-01-01')
  ` }).run();
  database.prepare({ sql: `
    INSERT INTO sessions (
      session_id, workspace_id, title, status, active_entry_id, created_at, updated_at, archived_at
    ) VALUES ('session:1', 'workspace:1', 'Session', 'active', NULL, '2026-01-01', '2026-01-01', NULL)
  ` }).run();
  database.prepare({ sql: `
    INSERT INTO session_messages (
      message_id, session_id, run_id, message_kind, message_json, created_at, completed_at
    ) VALUES
      ('message:1', 'session:1', NULL, 'user_message', '{}', '2026-01-01', '2026-01-01'),
      ('message:2', 'session:1', NULL, 'user_message', '{}', '2026-01-01', '2026-01-01')
  ` }).run();
  const insert = database.prepare({ sql: `
    INSERT INTO session_message_attachments (
      attachment_id, message_id, session_id, type, name, mime_type, source_type, source_value, created_at
    ) VALUES (?, ?, 'session:1', 'image', NULL, 'image/png', 'managed', ?, ?)
  ` });
  insert.run(['attachment:c', 'message:1', 'c.png', '2026-01-02']);
  insert.run(['attachment:b', 'message:1', 'b.png', '2026-01-01']);
  insert.run(['attachment:a', 'message:1', 'a.png', '2026-01-01']);
  insert.run(['attachment:z', 'message:2', 'z.png', '2026-01-03']);
}
