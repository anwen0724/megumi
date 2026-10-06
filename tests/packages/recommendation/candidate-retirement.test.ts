/*
 * Verifies that a pool relation which stopped qualifying is confirmed as exited
 * and then reclaimed, so neither relations nor the content they pin accumulate
 * forever. Reading already excludes expired content; this is the maintenance half.
 */
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCandidateStorage } from '@megumi/application/recommendation/candidates/candidate-storage';
import { retireExitedCandidates } from '@megumi/application/recommendation/candidates/evaluate-candidates';
import { createContentStorage } from '@megumi/application/recommendation/content/content-storage';
import { pruneUnusedContent } from '@megumi/application/recommendation/content/prune-content';
import {
  createDatabase,
  migrateDatabase,
  type DatabaseConnection,
} from '@megumi/application/storage/index';

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1_000;

describe('exited pool relations', () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
    seedInterest(database, 'i1');
  });

  afterEach(() => database.close());

  it('confirms an expired daily relation as exited with its reason', () => {
    seedContent(database, 'c1', NOW - 30 * DAY, 'learning');
    seedMatch(database, 'c1', 'i1', 'direct');
    seedRelation(database, 'c1', 'daily', 'active', NOW - 23 * DAY);

    const outcome = retire({ pool: 'daily' });

    expect(outcome).toEqual({ markedInactive: 1, removed: 0 });
    expect(relation(database, 'c1', 'daily')).toEqual({ status: 'inactive', reason: 'expired' });
  });

  it('reclaims a relation that was already confirmed and still does not qualify', () => {
    seedContent(database, 'c1', NOW - 30 * DAY, 'learning');
    seedMatch(database, 'c1', 'i1', 'direct');
    seedRelation(database, 'c1', 'daily', 'active', NOW - 23 * DAY);

    retire({ pool: 'daily' });
    expect(retire({ pool: 'daily' })).toEqual({ markedInactive: 0, removed: 1 });
    expect(relation(database, 'c1', 'daily')).toBeUndefined();
  });

  it('removes only the daily relation when the long-term pool still qualifies', () => {
    seedContent(database, 'c1', NOW - 30 * DAY, 'learning');
    seedMatch(database, 'c1', 'i1', 'direct');
    seedRelation(database, 'c1', 'daily', 'active', NOW - 23 * DAY);
    seedRelation(database, 'c1', 'long_term', 'active', null);

    retire({ pool: 'daily' });
    retire({ pool: 'daily' });

    expect(relation(database, 'c1', 'daily')).toBeUndefined();
    expect(relation(database, 'c1', 'long_term')).toEqual({ status: 'active', reason: undefined });
    expect(countRows(database, 'contents')).toBe(1);
  });

  it('releases the content once no pool relation and no retention keeps it', async () => {
    seedContent(database, 'c1', NOW - 30 * DAY, 'none');
    seedMatch(database, 'c1', 'i1', 'direct');
    seedRelation(database, 'c1', 'daily', 'active', NOW - 23 * DAY);

    retire({ pool: 'daily' });
    retire({ pool: 'daily' });
    await pruneUnusedContent(
      {
        database,
        contents: createContentStorage(database),
        candidates: createCandidateStorage(database),
        retention: { findRetainedContentIds: async () => [] },
      },
      { batchSize: 10 },
    );

    expect(countRows(database, 'recommendation_candidates')).toBe(0);
    expect(countRows(database, 'contents')).toBe(0);
  });

  it('confirms a long-term relation whose content has no long-term value as unsuitable', () => {
    seedContent(database, 'c1', NOW - DAY, 'none');
    seedMatch(database, 'c1', 'i1', 'direct');
    seedRelation(database, 'c1', 'long_term', 'active', null);

    expect(retire({ pool: 'long_term' })).toEqual({ markedInactive: 1, removed: 0 });
    expect(relation(database, 'c1', 'long_term')).toEqual({
      status: 'inactive',
      reason: 'unsuitable',
    });
  });

  it('confirms a relation whose interest is gone as unrelated', () => {
    seedContent(database, 'c1', NOW - DAY, 'learning');
    seedRelation(database, 'c1', 'long_term', 'active', null);

    expect(retire({ pool: 'long_term' })).toEqual({ markedInactive: 1, removed: 0 });
    expect(relation(database, 'c1', 'long_term')).toEqual({
      status: 'inactive',
      reason: 'unrelated',
    });
  });

  it('leaves a relation alone while its analysis is still unfinished', () => {
    seedContent(database, 'c1', NOW - DAY, 'learning', 'pending');
    seedMatch(database, 'c1', 'i1', 'direct');
    seedRelation(database, 'c1', 'long_term', 'active', null);

    expect(retire({ pool: 'long_term' })).toEqual({ markedInactive: 0, removed: 0 });
    expect(relation(database, 'c1', 'long_term')).toEqual({ status: 'active', reason: undefined });
  });

  /** Runs one tidy pass over one pool. */
  function retire(input: { readonly pool: 'daily' | 'long_term' }) {
    return retireExitedCandidates(
      { database, candidates: createCandidateStorage(database) },
      { pool: input.pool, freshnessDays: 7, now: NOW },
    );
  }
});

function seedInterest(database: DatabaseConnection, id: string): void {
  database
    .prepare({
      sql: 'INSERT INTO interests (id, text, enabled, created_at, updated_at) VALUES (?, ?, 1, 0, 0)',
    })
    .run([id, `interest ${id}`]);
}

function seedContent(
  database: DatabaseConnection,
  id: string,
  publishedAt: number,
  longTermValue: string,
  status = 'ready',
): void {
  database
    .prepare({
      sql: `INSERT INTO contents (id, source, canonical_url, text, published_at, created_at, updated_at)
            VALUES (?, 'zhihu', ?, '材料正文', ?, 0, 0)`,
    })
    .run([id, `https://example.com/${id}`, publishedAt]);
  database
    .prepare({
      sql: `INSERT INTO content_analysis
              (content_id, summary, key_points, topics, entities, content_type, quality_score,
               spam_score, long_term_value, status, attempts, analyzed_at)
            VALUES (?, '摘要', '[{"text":"要点","evidence":"材料正文"}]', '["主题"]', '["实体"]',
                    'article', 0.6, 0.1, ?, ?, 1, 0)`,
    })
    .run([id, longTermValue, status]);
}

function seedMatch(
  database: DatabaseConnection,
  contentId: string,
  interestId: string,
  relation: string,
): void {
  database
    .prepare({
      sql: `INSERT INTO content_interest_matches (content_id, interest_id, relation, matched_at)
            VALUES (?, ?, ?, 0)`,
    })
    .run([contentId, interestId, relation]);
}

function seedRelation(
  database: DatabaseConnection,
  contentId: string,
  pool: string,
  status: string,
  expiresAt: number | null,
): void {
  database
    .prepare({
      sql: `INSERT INTO recommendation_candidates
              (pool, content_id, status, inactive_reason, expires_at, created_at, updated_at)
            VALUES (?, ?, ?, NULL, ?, 0, 0)`,
    })
    .run([pool, contentId, status, expiresAt]);
}

function relation(
  database: DatabaseConnection,
  contentId: string,
  pool: string,
): { status: string; reason: string | undefined } | undefined {
  const row = database
    .prepare<{ status: string; inactive_reason: string | null }>({
      sql: 'SELECT status, inactive_reason FROM recommendation_candidates WHERE content_id = ? AND pool = ?',
    })
    .get([contentId, pool]);
  return row ? { status: row.status, reason: row.inactive_reason ?? undefined } : undefined;
}

function countRows(database: DatabaseConnection, table: string): number {
  const rows = database
    .prepare<{ total: number }>({ sql: `SELECT count(*) AS total FROM ${table}` })
    .all();
  return rows[0]?.total ?? 0;
}
