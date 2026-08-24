/* Verifies the durable schema required by daily personalized information discovery. */
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

const discoveryTables = [
  'discovery_batches',
  'discovery_interest_evidence',
  'discovery_interests',
  'discovery_recommendations',
  'discovery_session_policies',
] as const;

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe('daily discovery database migration', () => {
  it('creates exactly the five Discovery tables with the current migration', () => {
    const database = createDatabase({ filename: ':memory:' });
    try {
      const migrated = migrateDatabase({ database });
      expect(migrated.currentMigration).toBe('0013_discovery_content_identity_v2');
      const tables = tableNames(database).filter((name) => name.startsWith('discovery_'));
      expect(tables).toEqual([...discoveryTables]);
      expect(database.prepare({ sql: 'PRAGMA foreign_key_check' }).all()).toEqual([]);
    } finally {
      database.close();
    }
  });

  it('keeps source_id open to extensions while enforcing non-empty values and other checks', () => {
    const database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
    try {
      insertBatch(database);
      expect(() => insertRecommendation(database, 'custom_source')).not.toThrow();
      expect(() => insertRecommendation(database, '   ', 'recommendation:empty')).toThrow();
      expect(() => database.prepare({ sql: `
        INSERT INTO discovery_batches (
          batch_id, local_date, timezone, status, execution_id, target_count,
          attempt_count, automatic_retry_count, result_count,
          created_at, updated_at, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ` }).run([
        'batch:invalid', '2026-08-23', 'Asia/Shanghai', 'unknown', 'execution:2',
        0, 0, 3, -1, now, now, now,
      ])).toThrow();
    } finally {
      database.close();
    }
  });

  it('upgrades a database at 0011 without losing existing product data', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-discovery-upgrade-'));
    const partialMigrations = path.join(tempDir, 'migrations-0011');
    const databasePath = path.join(tempDir, 'megumi.sqlite3');
    createMigrationFolderAt0011(partialMigrations);

    const database = createDatabase({ filename: databasePath });
    try {
      expect(migrateDatabase({ database, migrationsFolder: partialMigrations }).currentMigration)
        .toBe('0011_execution_id');
      database.prepare({ sql: `
        INSERT INTO workspaces (
          workspace_id, name, root_path, root_path_key, status,
          created_at, updated_at, last_opened_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ` }).run(['workspace:kept', 'Kept', 'C:/kept', 'c:/kept', 'active', now, now, now]);

      expect(migrateDatabase({ database }).currentMigration)
        .toBe('0013_discovery_content_identity_v2');
      expect(database.prepare<{ name: string }>({
        sql: 'SELECT name FROM workspaces WHERE workspace_id = ?',
      }).get(['workspace:kept'])).toEqual({ name: 'Kept' });
      expect(tableNames(database)).toEqual(expect.arrayContaining([...discoveryTables]));
    } finally {
      database.close();
    }
  });
});

const now = '2026-08-22T00:00:00.000Z';

function insertBatch(database: DatabaseConnection): void {
  database.prepare({ sql: `
    INSERT INTO discovery_batches (
      batch_id, local_date, timezone, status, execution_id, target_count,
      attempt_count, automatic_retry_count, result_count,
      created_at, updated_at, started_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ` }).run([
    'batch:1', '2026-08-22', 'Asia/Shanghai', 'running', 'execution:1',
    20, 1, 0, 0, now, now, now,
  ]);
}

function insertRecommendation(
  database: DatabaseConnection,
  sourceId: string,
  recommendationId = 'recommendation:1',
): void {
  database.prepare({ sql: `
    INSERT INTO discovery_recommendations (
      recommendation_id, batch_id, content_identity, position,
      source_id, source_name, canonical_url, title, content_type,
      recommendation_reason, published_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ` }).run([
    recommendationId,
    'batch:1',
    `identity:${recommendationId}`,
    recommendationId === 'recommendation:1' ? 0 : 1,
    sourceId,
    'Custom',
    'https://example.com/item',
    'Item',
    'article',
    'Relevant.',
    now,
  ]);
}

function tableNames(database: DatabaseConnection): string[] {
  return database.prepare<{ name: string }>({ sql: `
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle_%'
    ORDER BY name
  ` }).all().map((row) => row.name);
}

function createMigrationFolderAt0011(target: string): void {
  const source = path.join(process.cwd(), 'packages/agent/database/migrations');
  fs.mkdirSync(path.join(target, 'meta'), { recursive: true });
  for (const filename of fs.readdirSync(source)) {
    if (/^00(?:0\d|1[01])_.+\.sql$/u.test(filename)) {
      fs.copyFileSync(path.join(source, filename), path.join(target, filename));
    }
  }
  const journal = JSON.parse(fs.readFileSync(path.join(source, 'meta/_journal.json'), 'utf8')) as {
    entries: Array<{ idx: number }>;
  };
  fs.writeFileSync(path.join(target, 'meta/_journal.json'), JSON.stringify({
    ...journal,
    entries: journal.entries.filter((entry) => entry.idx <= 11),
  }));
}
