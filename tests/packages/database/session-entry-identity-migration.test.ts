/* Verifies Session Entry content identities remain unique across database upgrades. */
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

describe('Session Entry identity migration', () => {
  it('rejects two Message Entries that reference the same Message', () => {
    const database = createMigratedDatabase();
    try {
      seedSession(database);
      insertMessage(database, 'message:1');
      insertMessageEntry(database, { entryId: 'entry:1', messageId: 'message:1' });

      expect(() => insertMessageEntry(database, {
        entryId: 'entry:duplicate',
        messageId: 'message:1',
      })).toThrow();
    } finally {
      database.close();
    }
  });

  it('rejects two Compaction Entries that reference the same Compaction', () => {
    const database = createMigratedDatabase();
    try {
      seedSession(database);
      insertMessage(database, 'message:anchor');
      insertMessageEntry(database, { entryId: 'entry:anchor', messageId: 'message:anchor' });
      insertCompaction(database, 'compaction:1', 'entry:anchor');
      insertCompactionEntry(database, 'entry:compaction:1', 'compaction:1');

      expect(() => insertCompactionEntry(
        database,
        'entry:compaction:duplicate',
        'compaction:1',
      )).toThrow();
    } finally {
      database.close();
    }
  });

  it('allows different Messages to form sibling branches under one parent Entry', () => {
    const database = createMigratedDatabase();
    try {
      seedSession(database);
      insertMessage(database, 'message:root');
      insertMessage(database, 'message:left');
      insertMessage(database, 'message:right');
      insertMessageEntry(database, { entryId: 'entry:root', messageId: 'message:root' });
      insertMessageEntry(database, {
        entryId: 'entry:left',
        messageId: 'message:left',
        parentEntryId: 'entry:root',
      });
      insertMessageEntry(database, {
        entryId: 'entry:right',
        messageId: 'message:right',
        parentEntryId: 'entry:root',
      });

      expect(database.prepare<{ entry_id: string }>({ sql: `
        SELECT entry_id FROM session_entries
        WHERE parent_entry_id = 'entry:root'
        ORDER BY entry_id
      ` }).all()).toEqual([
        { entry_id: 'entry:left' },
        { entry_id: 'entry:right' },
      ]);
    } finally {
      database.close();
    }
  });

  it('fails an upgrade with duplicate Message references without rewriting existing Entries', () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-session-entry-identity-'));
    const releasedMigrations = path.join(tempRoot, 'released-migrations');
    copyMigrationsBeforeIdentityConstraint(releasedMigrations);
    const database = createDatabase({ filename: path.join(tempRoot, 'megumi.sqlite3') });

    try {
      migrateDatabase({ database, migrationsFolder: releasedMigrations });
      seedSession(database);
      insertMessage(database, 'message:1');
      insertMessageEntry(database, { entryId: 'entry:1', messageId: 'message:1' });
      insertMessageEntry(database, { entryId: 'entry:duplicate', messageId: 'message:1' });

      let failure: unknown;
      try {
        migrateDatabase({ database, migrationsFolder: migrationsRoot });
      } catch (error) {
        failure = error;
      }

      expect(failure).toMatchObject({
        name: 'DatabaseMigrationError',
        migration: '0018_session_entry_identity',
        reason: 'sql_migration_failed',
      });
      expect(database.prepare<{ entry_id: string }>({ sql: `
        SELECT entry_id FROM session_entries
        WHERE message_id = 'message:1'
        ORDER BY entry_id
      ` }).all()).toEqual([
        { entry_id: 'entry:1' },
        { entry_id: 'entry:duplicate' },
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

function copyMigrationsBeforeIdentityConstraint(target: string): void {
  fs.mkdirSync(path.join(target, 'meta'), { recursive: true });
  const journal = JSON.parse(fs.readFileSync(path.join(migrationsRoot, 'meta/_journal.json'), 'utf8')) as {
    entries: Array<{ readonly tag: string }>;
  };
  const releasedEntries = journal.entries.filter((entry) => (
    entry.tag !== '0018_session_entry_identity'
  ));
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

function seedSession(database: DatabaseConnection): void {
  database.prepare({ sql: `
    INSERT INTO workspaces (
      workspace_id, name, root_path, root_path_key, status,
      created_at, updated_at, last_opened_at
    ) VALUES (
      'workspace:1', 'Workspace', '/workspace', '/workspace', 'available',
      '2026-09-03T00:00:00.000Z', '2026-09-03T00:00:00.000Z', '2026-09-03T00:00:00.000Z'
    )
  ` }).run();
  database.prepare({ sql: `
    INSERT INTO sessions (
      session_id, workspace_id, title, status, created_at, updated_at
    ) VALUES (
      'session:1', 'workspace:1', 'Session', 'active',
      '2026-09-03T00:00:00.000Z', '2026-09-03T00:00:00.000Z'
    )
  ` }).run();
}

function insertMessage(database: DatabaseConnection, messageId: string): void {
  database.prepare({ sql: `
    INSERT INTO session_messages (
      message_id, session_id, execution_id, message_kind,
      message_json, created_at, completed_at
    ) VALUES (?, 'session:1', NULL, 'user_message', ?, ?, ?)
  ` }).run([
    messageId,
    JSON.stringify({ display_content: [], model_content: [] }),
    '2026-09-03T00:01:00.000Z',
    '2026-09-03T00:01:00.000Z',
  ]);
}

function insertMessageEntry(database: DatabaseConnection, input: {
  readonly entryId: string;
  readonly messageId: string;
  readonly parentEntryId?: string;
}): void {
  database.prepare({ sql: `
    INSERT INTO session_entries (
      entry_id, session_id, parent_entry_id, entry_type, message_id, created_at
    ) VALUES (?, 'session:1', ?, 'message', ?, '2026-09-03T00:01:00.000Z')
  ` }).run([input.entryId, input.parentEntryId ?? null, input.messageId]);
}

function insertCompaction(
  database: DatabaseConnection,
  compactionId: string,
  anchorEntryId: string,
): void {
  database.prepare({ sql: `
    INSERT INTO session_compactions (
      compaction_id, session_id, anchor_entry_id, trigger, status, started_at
    ) VALUES (?, 'session:1', ?, 'manual', 'running', '2026-09-03T00:02:00.000Z')
  ` }).run([compactionId, anchorEntryId]);
}

function insertCompactionEntry(
  database: DatabaseConnection,
  entryId: string,
  compactionId: string,
): void {
  database.prepare({ sql: `
    INSERT INTO session_entries (
      entry_id, session_id, entry_type, compaction_id, created_at
    ) VALUES (?, 'session:1', 'compaction', ?, '2026-09-03T00:02:00.000Z')
  ` }).run([entryId, compactionId]);
}
