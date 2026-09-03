/* Verifies the rebuilt Recommendation schema and its development-time cleanup boundary. */
// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase, type DatabaseConnection } from '../../../packages/agent/database/src';

const recommendationTables = [
  'discovery_recommendations',
  'discovery_recommendation_contents',
  'discovery_recommendation_states',
] as const;
let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe('Recommendation database migration', () => {
  it('creates the three Recommendation tables and removes obsolete execution/event tables', () => {
    const database = createDatabase({ filename: ':memory:' });
    try {
      migrateDatabase({ database });
      const tables = tableNames(database);
      expect(tables).toEqual(expect.arrayContaining([...recommendationTables]));
      expect(tables).not.toContain('discovery_batches');
      expect(tables).not.toContain('discovery_feedback_changes');
      expect(database.prepare({ sql: 'PRAGMA foreign_key_check' }).all()).toEqual([]);
    } finally {
      database.close();
    }
  });

  it('keeps Source identity open while enforcing a non-empty content Source', () => {
    const database = createDatabase({ filename: ':memory:' });
    try {
      migrateDatabase({ database });
      seedRecommendationDecision(database, 'recommendation:1', 'candidate:1', 0);
      expect(() => insertContent(database, 'recommendation-content:1', 'recommendation:1', 'custom_source'))
        .not.toThrow();
      seedRecommendationDecision(database, 'recommendation:2', 'candidate:2', 1);
      expect(() => insertContent(database, 'recommendation-content:2', 'recommendation:2', '   ')).toThrow();
    } finally {
      database.close();
    }
  });

  it('upgrades a database at 0011, preserves unrelated product data, and installs the rebuilt schema', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-recommendation-upgrade-'));
    const partialMigrations = path.join(tempDir, 'migrations-0011');
    const databasePath = path.join(tempDir, 'megumi.sqlite3');
    createMigrationFolderAt0011(partialMigrations);
    const database = createDatabase({ filename: databasePath });
    try {
      expect(migrateDatabase({ database, migrationsFolder: partialMigrations }).currentMigration).toBe('0011_execution_id');
      database.prepare({ sql: `
        INSERT INTO workspaces (
          workspace_id, name, root_path, root_path_key, status, created_at, updated_at, last_opened_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ` }).run(['workspace:kept', 'Kept', 'C:/kept', 'c:/kept', 'active', now, now, now]);
      migrateDatabase({ database });
      expect(database.prepare<{ name: string }>({
        sql: 'SELECT name FROM workspaces WHERE workspace_id = ?',
      }).get(['workspace:kept'])).toEqual({ name: 'Kept' });
      expect(tableNames(database)).toEqual(expect.arrayContaining([...recommendationTables]));
    } finally {
      database.close();
    }
  });
});

const now = '2026-08-22T00:00:00.000Z';

function seedRecommendationDecision(
  database: DatabaseConnection,
  recommendationId: string,
  candidateId: string,
  position: number,
): void {
  database.prepare({ sql: `
    INSERT INTO discovery_candidates (
      id, content_identity, source_id, canonical_url, content_type, title,
      content_summary, content_truncated, status, created_at, expires_at
    ) VALUES (?, ?, 'custom_source', ?, 'article', 'Item', 'Summary', 0, 'consumed', ?, ?)
  ` }).run([candidateId, `identity:${candidateId}`, `https://example.com/${candidateId}`, now, '2026-09-22T00:00:00.000Z']);
  database.prepare({ sql: `
    INSERT INTO discovery_recommendations (
      id, candidate_id, content_identity, local_date, position,
      recommendation_reason, selection_basis_json, published_at
    ) VALUES (?, ?, ?, '2026-08-22', ?, 'Relevant.', ?, ?)
  ` }).run([
    recommendationId,
    candidateId,
    `identity:${candidateId}`,
    position,
    JSON.stringify({
      primaryInterestId: 'interest:1', matchedInterestIds: ['interest:1'],
      interestRevisions: [{ interestId: 'interest:1', revision: 1 }], preferenceRevisions: [],
    }),
    now,
  ]);
}

function insertContent(
  database: DatabaseConnection,
  id: string,
  recommendationId: string,
  sourceId: string,
): void {
  database.prepare({ sql: `
    INSERT INTO discovery_recommendation_contents (
      id, recommendation_id, source_id, source_name, canonical_url,
      content_type, title, content_summary, content_truncated
    ) VALUES (?, ?, ?, 'Custom', ?, 'article', 'Item', 'Summary', 0)
  ` }).run([id, recommendationId, sourceId, `https://example.com/${id}`]);
}

function tableNames(database: DatabaseConnection): string[] {
  return database.prepare<{ name: string }>({ sql: `
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle_%'
    ORDER BY name
  ` }).all().map(({ name }) => name);
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
