/* Verifies Candidate Supply old runtime data is discarded and only its two business tables remain. */
// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase, type DatabaseConnection } from '@megumi/database';

const migrationsRoot = path.join(process.cwd(), 'packages/agent/database/migrations');
let tempRoot: string | undefined;

afterEach(() => {
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = undefined;
});

describe('Candidate Supply redesign migration', () => {
  it('drops all legacy Candidate Supply data and creates the two target tables', () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-candidate-supply-redesign-'));
    const releasedMigrations = path.join(tempRoot, 'released-migrations');
    copyMigrationsBeforeRedesign(releasedMigrations);
    const database = createDatabase({ filename: path.join(tempRoot, 'megumi.sqlite3') });

    try {
      migrateDatabase({ database, migrationsFolder: releasedMigrations });
      seedLegacyCandidate(database);
      migrateDatabase({ database, migrationsFolder: migrationsRoot });

      expect(candidateTables(database)).toEqual([
        'discovery_candidate_interest_matches',
        'discovery_candidates',
      ]);
      expect(database.prepare<{ count: number }>({
        sql: 'SELECT COUNT(*) AS count FROM discovery_candidates',
      }).get()?.count).toBe(0);
      expect(() => database.prepare({ sql: `
        INSERT INTO discovery_candidates (
          id, content_identity, source_id, canonical_url, content_type, title,
          content_summary, status, created_at, expires_at
        ) VALUES (
          'candidate:invalid', 'content:invalid', 'source:1', 'https://example.com',
          'article', 'Title', 'Summary', 'available', ?, ?
        )
      ` }).run(['2026-09-03T00:00:00.000Z', '2026-09-02T00:00:00.000Z'])).toThrow();
    } finally {
      database.close();
    }
  });

  it('clears pre-amendment Candidates and installs durable content and match fields', () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-candidate-content-amendment-'));
    const previousMigrations = path.join(tempRoot, 'previous-migrations');
    copyMigrationsBefore(previousMigrations, 22);
    const database = createDatabase({ filename: path.join(tempRoot, 'megumi.sqlite3') });

    try {
      migrateDatabase({ database, migrationsFolder: previousMigrations });
      database.prepare({ sql: `
        INSERT INTO discovery_candidates (
          id, content_identity, source_id, canonical_url, content_type, title,
          selection_reason, status, created_at, expires_at
        ) VALUES (
          'candidate:old', 'content:old', 'source:1', 'https://example.com/old',
          'article', 'Old Candidate', 'Old reason', 'available', ?, ?
        )
      ` }).run(['2026-09-03T00:00:00.000Z', '2026-10-03T00:00:00.000Z']);

      migrateDatabase({ database, migrationsFolder: migrationsRoot });

      expect(database.prepare<{ count: number }>({
        sql: 'SELECT COUNT(*) AS count FROM discovery_candidates',
      }).get()?.count).toBe(0);
      expect(columnNames(database, 'discovery_candidates')).toEqual(expect.arrayContaining([
        'content_summary', 'content_excerpt', 'content_truncated',
      ]));
      expect(columnNames(database, 'discovery_candidates')).not.toContain('selection_reason');
      expect(columnNames(database, 'discovery_candidate_interest_matches')).toContain('match_reason');
    } finally {
      database.close();
    }
  });
});

function copyMigrationsBeforeRedesign(target: string): void {
  copyMigrationsBefore(target, 21);
}

function copyMigrationsBefore(target: string, migrationIndex: number): void {
  fs.mkdirSync(path.join(target, 'meta'), { recursive: true });
  const journal = JSON.parse(fs.readFileSync(path.join(migrationsRoot, 'meta/_journal.json'), 'utf8')) as {
    entries: Array<{ readonly idx: number; readonly tag: string }>;
  };
  const releasedEntries = journal.entries.filter((entry) => entry.idx < migrationIndex);
  for (const entry of releasedEntries) {
    fs.copyFileSync(path.join(migrationsRoot, `${entry.tag}.sql`), path.join(target, `${entry.tag}.sql`));
  }
  fs.writeFileSync(path.join(target, 'meta/_journal.json'), JSON.stringify({
    ...journal,
    entries: releasedEntries,
  }));
}

function columnNames(database: DatabaseConnection, table: string): readonly string[] {
  return database.prepare<{ name: string }>({ sql: `PRAGMA table_info(${table})` })
    .all()
    .map(({ name }) => name);
}

function seedLegacyCandidate(database: DatabaseConnection): void {
  database.prepare({ sql: `
    INSERT INTO discovery_candidates (
      candidate_id, content_identity, status, primary_source_id, primary_source_name,
      canonical_url, content_type, title, first_seen_at, last_seen_at, expires_at, status_updated_at
    ) VALUES (
      'candidate:legacy', 'content:legacy', 'available', 'source:1', 'Source',
      'https://example.com/legacy', 'article', 'Legacy', ?, ?, ?, ?
    )
  ` }).run([
    '2026-09-01T00:00:00.000Z',
    '2026-09-01T00:00:00.000Z',
    '2026-10-01T00:00:00.000Z',
    '2026-09-01T00:00:00.000Z',
  ]);
}

function candidateTables(database: DatabaseConnection): readonly string[] {
  return database.prepare<{ name: string }>({ sql: `
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name LIKE 'discovery_candidate%'
    ORDER BY name
  ` }).all().map(({ name }) => name);
}
