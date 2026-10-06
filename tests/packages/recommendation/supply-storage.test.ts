/* Verifies interest changes, relation commits, and content removal stay atomic. */
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createDatabase,
  migrateDatabase,
  type DatabaseConnection,
} from '@megumi/application/storage/index';
import { createCandidateStorage } from '@megumi/application/recommendation/candidates/candidate-storage';
import { createContentStorage } from '@megumi/application/recommendation/content/content-storage';
import { createInterestStorage } from '@megumi/application/recommendation/interests/interest-storage';

describe('candidate supply storage', () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = openSupplyDatabase();
  });

  afterEach(() => database.close());

  it('clears matches and retires queries when the description changes', () => {
    const interests = createInterestStorage(database);
    const candidates = createCandidateStorage(database);
    interests.create({ id: 'i1', text: '摄影', now: 1 });
    insertSearchResult(database, 'r1', 'https://example.com/a');
    saveContent(database, 'c1', 'https://example.com/a', 2);
    insertQuery(database, 'q1', 'i1');
    candidates.commitRelations({
      contentId: 'c1',
      matches: [{ interestId: 'i1', expectedText: '摄影', relation: 'direct' }],
      pools: [{ pool: 'daily' }],
      now: 3,
    });

    interests.update({ id: 'i1', text: '摄影 后期', now: 4 });

    expect(countRows(database, 'content_interest_matches')).toBe(0);
    expect(queryStatus(database, 'q1')).toBe('retired');
    expect(countRows(database, 'search_queries')).toBe(1);
  });

  it('keeps saved matches when a save changes neither text nor enabled state', () => {
    const interests = createInterestStorage(database);
    const candidates = createCandidateStorage(database);
    interests.create({ id: 'i1', text: '摄影', now: 1 });
    insertSearchResult(database, 'r1', 'https://example.com/a');
    saveContent(database, 'c1', 'https://example.com/a', 2);
    candidates.commitRelations({
      contentId: 'c1',
      matches: [{ interestId: 'i1', expectedText: '摄影', relation: 'direct' }],
      pools: [{ pool: 'daily' }],
      now: 3,
    });

    interests.update({ id: 'i1', text: '摄影', enabled: true, now: 4 });

    expect(countRows(database, 'content_interest_matches')).toBe(1);
  });

  it('skips a relation whose interest changed since the task read it', () => {
    const interests = createInterestStorage(database);
    const candidates = createCandidateStorage(database);
    interests.create({ id: 'i1', text: '摄影', now: 1 });
    insertSearchResult(database, 'r1', 'https://example.com/a');
    saveContent(database, 'c1', 'https://example.com/a', 2);
    interests.update({ id: 'i1', text: '摄影 后期', now: 3 });

    const result = candidates.commitRelations({
      contentId: 'c1',
      matches: [{ interestId: 'i1', expectedText: '摄影', relation: 'direct' }],
      pools: [{ pool: 'daily' }],
      now: 4,
    });

    expect(result.committedInterestIds).toEqual([]);
    expect(result.skippedInterestIds).toEqual(['i1']);
    expect(result.committedPools).toEqual([]);
    expect(countRows(database, 'recommendation_candidates')).toBe(0);
  });

  it('drops matches with a deleted interest and keeps the content', () => {
    const interests = createInterestStorage(database);
    const candidates = createCandidateStorage(database);
    interests.create({ id: 'i1', text: '摄影', now: 1 });
    interests.create({ id: 'i2', text: '后期', now: 1 });
    insertSearchResult(database, 'r1', 'https://example.com/a');
    saveContent(database, 'c1', 'https://example.com/a', 2);
    candidates.commitRelations({
      contentId: 'c1',
      matches: [
        { interestId: 'i1', expectedText: '摄影', relation: 'direct' },
        { interestId: 'i2', expectedText: '后期', relation: 'related' },
      ],
      pools: [{ pool: 'daily' }],
      now: 3,
    });

    expect(interests.remove('i1')).toBe(true);

    expect(countRows(database, 'content_interest_matches')).toBe(1);
    expect(countRows(database, 'contents')).toBe(1);
    expect(countRows(database, 'recommendation_candidates')).toBe(1);
  });

  it('removes content with its analysis row and discovery link', () => {
    const candidates = createCandidateStorage(database);
    insertSearchResult(database, 'r1', 'https://example.com/a');
    saveContent(database, 'c1', 'https://example.com/a', 2);

    candidates.markInactive({ contentId: 'c1', pool: 'daily', reason: 'expired', now: 3 });
    createContentStorage(database).removeContent('c1');

    expect(countRows(database, 'contents')).toBe(0);
    expect(countRows(database, 'content_analysis')).toBe(0);
    expect(countRows(database, 'search_results')).toBe(0);
    expect(database.prepare({ sql: 'PRAGMA foreign_key_check' }).all()).toEqual([]);
  });
});

function openSupplyDatabase(): DatabaseConnection {
  const database = createDatabase({ filename: ':memory:' });
  migrateDatabase({ database });
  return database;
}

function saveContent(
  database: DatabaseConnection,
  id: string,
  canonicalUrl: string,
  now: number,
): void {
  createContentStorage(database).saveNormalized({
    content: { id, source: 'zhihu', canonicalUrl, text: 'material text' },
    sourceResultId: 'r1',
    sourceUrl: canonicalUrl,
    now,
  });
}

function insertSearchResult(database: DatabaseConnection, id: string, url: string): void {
  database
    .prepare({
      sql: `INSERT INTO search_results (id, source, url, status, attempts, first_seen_at, last_seen_at)
            VALUES (?, 'zhihu', ?, 'pending', 0, 0, 0)`,
    })
    .run([id, url]);
}

function insertQuery(database: DatabaseConnection, id: string, interestId: string): void {
  database
    .prepare({
      sql: `INSERT INTO search_queries (id, interest_id, query, category, origin, status, created_at)
            VALUES (?, ?, '摄影', 'core', 'ai', 'active', 0)`,
    })
    .run([id, interestId]);
}

function queryStatus(database: DatabaseConnection, id: string): string | undefined {
  return database
    .prepare<{ status: string }>({ sql: 'SELECT status FROM search_queries WHERE id = ?' })
    .get([id])?.status;
}

function countRows(database: DatabaseConnection, table: string): number {
  const rows = database
    .prepare<{ total: number }>({ sql: `SELECT count(*) AS total FROM ${table}` })
    .all();
  return rows[0]?.total ?? 0;
}
