// @vitest-environment node
/* Exercises the actual pre-memory migration chain and reopening an upgraded file. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { expect, it } from 'vitest';
import { createDatabase, migrateDatabase } from '@megumi/application/storage/index';

it('upgrades a pre-memory database without changing saved sessions, branches or reply payloads', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-upgrade-'));
  const migrations = path.join(root, 'old-migrations');
  const filename = path.join(root, 'database.sqlite');
  const current = path.resolve('packages/application/resources/migrations');
  fs.cpSync(current, migrations, { recursive: true });
  const journalPath = path.join(migrations, 'meta', '_journal.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= 37);
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  let database = createDatabase({ filename });
  try {
    migrateDatabase({ database, migrationsFolder: migrations });
    database.prepare({ sql: `INSERT INTO workspaces VALUES ('w1', 'old', 'C:/old', 'c:/old', 'available', '2026-10-01', '2026-10-01', '2026-10-01')` }).run();
    database.prepare({ sql: `INSERT INTO sessions(session_id,workspace_id,title,status,active_entry_id,created_at,updated_at)
      VALUES ('s1','w1','Kept title','active',NULL,'2026-10-01','2026-10-07')` }).run();
    const payload = JSON.stringify({ status: 'completed', content: [{ type: 'text', text: 'Original reply' }] });
    database.prepare({ sql: `INSERT INTO session_messages VALUES ('m1','s1','run1','assistant_reply',?,'2026-10-02','2026-10-02')` }).run([payload]);
    database.prepare({ sql: `INSERT INTO session_entries VALUES ('e1','s1',NULL,'message','m1',NULL,'2026-10-02')` }).run();
    database.prepare({ sql: "UPDATE sessions SET active_entry_id = 'e1' WHERE session_id = 's1'" }).run();
    expect(migrateDatabase({ database }).appliedMigrations).toBe(2);
    database.prepare({ sql: "UPDATE memory_state SET dirty_revision = 2 WHERE id = 1" }).run();
    database.close();
    database = createDatabase({ filename });
    expect(migrateDatabase({ database }).appliedMigrations).toBe(0);
    expect(database.prepare({ sql: 'SELECT title, active_entry_id, content_updated_at FROM sessions' }).get())
      .toEqual({ title: 'Kept title', active_entry_id: 'e1', content_updated_at: '2026-10-02' });
    expect(database.prepare({ sql: 'SELECT message_json FROM session_messages' }).get()).toEqual({ message_json: payload });
    expect(database.prepare({ sql: 'SELECT sequence, message_id FROM session_reply_sequence' }).get()).toEqual({ sequence: 1, message_id: 'm1' });
    expect(database.prepare({ sql: 'SELECT dirty_revision FROM memory_state' }).get()).toEqual({ dirty_revision: 2 });
  } finally { database.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
