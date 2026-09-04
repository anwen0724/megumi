/* Verifies legacy Interest execution rows are removed while Session Participation facts survive. */
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

describe('Interest business facts migration', () => {
  it('backfills a stable Participation ID and removes execution-only Understanding rows', () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-interest-business-facts-'));
    const releasedMigrations = path.join(tempRoot, 'released-migrations');
    copyMigrationsBeforeInterestBusinessFacts(releasedMigrations);
    const database = createDatabase({ filename: path.join(tempRoot, 'megumi.sqlite3') });

    try {
      migrateDatabase({ database, migrationsFolder: releasedMigrations });
      seedWorkspaceAndSession(database);
      database.prepare({ sql: `
        INSERT INTO discovery_session_policies (
          session_id, participation, effective_from, updated_at
        ) VALUES ('session:1', 'included', ?, ?)
      ` }).run(['2026-09-03T00:00:00.000Z', '2026-09-03T00:00:00.000Z']);
      database.prepare({ sql: `
        INSERT INTO discovery_interest_understandings (
          interest_understanding_id, execution_id, session_id, user_message_id,
          assistant_message_id, status, queued_at
        ) VALUES (
          'understanding:1', 'execution:1', 'session:1', 'message:user:1',
          'message:assistant:1', 'queued', '2026-09-03T00:00:00.000Z'
        )
      ` }).run();

      migrateDatabase({ database, migrationsFolder: migrationsRoot });

      const participation = database.prepare<{
        id: string;
        session_id: string;
        participation: string;
      }>({ sql: 'SELECT * FROM discovery_interest_session_settings WHERE session_id = ?' }).get(['session:1']);
      expect(participation).toMatchObject({ session_id: 'session:1', participation: 'included' });
      expect(participation?.id).toMatch(/^session-participation:[a-f0-9]{32}$/u);
      expect(database.prepare<{ name: string }>({ sql: `
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name = 'discovery_interest_understandings'
      ` }).get()).toBeUndefined();
      expect(() => database.prepare({ sql: `
        INSERT INTO discovery_interest_session_settings (
          id, session_id, participation, effective_from, updated_at
        ) VALUES ('session-participation:duplicate', 'session:1', 'excluded', ?, ?)
      ` }).run(['2026-09-03T00:01:00.000Z', '2026-09-03T00:01:00.000Z'])).toThrow();
    } finally {
      database.close();
    }
  });
});

function copyMigrationsBeforeInterestBusinessFacts(target: string): void {
  fs.mkdirSync(path.join(target, 'meta'), { recursive: true });
  const journal = JSON.parse(fs.readFileSync(path.join(migrationsRoot, 'meta/_journal.json'), 'utf8')) as {
    entries: Array<{ readonly idx: number; readonly tag: string }>;
  };
  const releasedEntries = journal.entries.filter((entry) => entry.idx < 20);
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

function seedWorkspaceAndSession(database: DatabaseConnection): void {
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
