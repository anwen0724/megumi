/* Verifies the supply migration creates the nine new tables and the switch drops the legacy ones. */
// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createDatabase,
  migrateDatabase,
  type DatabaseConnection,
} from '@megumi/application/storage/index';

const SUPPLY_TABLES = [
  'interests',
  'contents',
  'content_analysis',
  'content_interest_matches',
  'recommendation_candidates',
  'search_queries',
  'search_results',
  'search_history',
  'candidate_supply_state',
];

const LEGACY_TABLES = [
  'discovery_interests',
  'discovery_interest_evidence',
  'discovery_interest_session_settings',
  'discovery_preference_sets',
  'discovery_preferences',
  'discovery_preference_evidence',
  'discovery_candidates',
  'discovery_candidate_interest_matches',
  'discovery_recommendations',
  'discovery_recommendation_contents',
  'discovery_recommendation_states',
];

describe('candidate supply migrations', () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
  });

  afterEach(() => database.close());

  it('creates every supply table and keeps the legacy tables until the switch', () => {
    for (const table of SUPPLY_TABLES) expect(tableExists(database, table)).toBe(true);
    for (const table of LEGACY_TABLES) expect(tableExists(database, table)).toBe(true);
    expect(database.prepare({ sql: 'PRAGMA foreign_key_check' }).all()).toEqual([]);
  });

  it('keeps one content per canonical URL and one qualification per pool and content', () => {
    insertInterest(database, 'i1');
    insertContent(database, 'c1', 'https://example.com/a');

    expect(() => insertContent(database, 'c2', 'https://example.com/a')).toThrow();

    expect(() =>
      database
        .prepare({
          sql: "INSERT INTO recommendation_candidates (pool, content_id, status, inactive_reason, created_at, updated_at) VALUES ('daily','c1','inactive',NULL,0,0)",
        })
        .run(),
    ).toThrow();

    expect(() =>
      database
        .prepare({
          sql: "INSERT INTO recommendation_candidates (pool, content_id, status, created_at, updated_at) VALUES ('weekly','c1','active',0,0)",
        })
        .run(),
    ).toThrow();

    database
      .prepare({
        sql: "INSERT INTO recommendation_candidates (pool, content_id, status, created_at, updated_at) VALUES ('daily','c1','active',0,0)",
      })
      .run();
    expect(candidatePools(database)).toEqual(['daily']);
  });

  it('clears matches with their interest while keeping the content facts', () => {
    insertInterest(database, 'i1');
    insertInterest(database, 'i2');
    insertContent(database, 'c1', 'https://example.com/a');
    database
      .prepare({
        sql: "INSERT INTO content_interest_matches (content_id, interest_id, relation, matched_at) VALUES ('c1','i1','direct',0), ('c1','i2','none',0)",
      })
      .run();

    database.prepare({ sql: "DELETE FROM interests WHERE id = 'i1'" }).run();

    expect(
      database
        .prepare<{ interest_id: string }>({ sql: 'SELECT interest_id FROM content_interest_matches' })
        .all(),
    ).toEqual([{ interest_id: 'i2' }]);
    expect(tableRowCount(database, 'contents')).toBe(1);
  });

  it('removes the legacy tables and keeps the supply tables when the switch runs', () => {
    applyLegacyRemoval(database);

    for (const table of LEGACY_TABLES) expect(tableExists(database, table)).toBe(false);
    for (const table of SUPPLY_TABLES) expect(tableExists(database, table)).toBe(true);
    expect(database.prepare({ sql: 'PRAGMA foreign_key_check' }).all()).toEqual([]);
  });
});

/** Applies the not-yet-registered switch migration the way the release will. */
function applyLegacyRemoval(database: DatabaseConnection): void {
  const file = path.join(
    process.cwd(),
    'packages/application/resources/migrations/0029_remove_legacy_discovery.sql',
  );
  for (const statement of fs.readFileSync(file, 'utf8').split('--> statement-breakpoint')) {
    const sql = statement.trim();
    if (sql) database.prepare({ sql }).run();
  }
}

function insertInterest(database: DatabaseConnection, id: string): void {
  database
    .prepare({
      sql: 'INSERT INTO interests (id, text, enabled, created_at, updated_at) VALUES (?, ?, 1, 0, 0)',
    })
    .run([id, `interest ${id}`]);
}

function insertContent(database: DatabaseConnection, id: string, url: string): void {
  database
    .prepare({
      sql: "INSERT INTO contents (id, source, canonical_url, text, created_at, updated_at) VALUES (?, 'zhihu', ?, 'material text', 0, 0)",
    })
    .run([id, url]);
}

function candidatePools(database: DatabaseConnection): string[] {
  return database
    .prepare<{ pool: string }>({ sql: 'SELECT pool FROM recommendation_candidates' })
    .all()
    .map((row) => row.pool);
}

function tableRowCount(database: DatabaseConnection, table: string): number {
  const rows = database
    .prepare<{ total: number }>({ sql: `SELECT count(*) AS total FROM ${table}` })
    .all();
  return rows[0]?.total ?? 0;
}

function tableExists(database: DatabaseConnection, table: string): boolean {
  return Boolean(
    database
      .prepare({
        sql: "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
      })
      .get([table]),
  );
}
