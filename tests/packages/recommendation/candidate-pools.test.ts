/* Verifies interest management, pool qualification, and content pruning. */
// @vitest-environment node
import { createCandidateStorage } from '@megumi/application/recommendation/candidates/candidate-storage';
import { evaluatePool } from '@megumi/application/recommendation/candidates/evaluate-candidates';
import { createContentStorage } from '@megumi/application/recommendation/content/content-storage';
import { pruneUnusedContent } from '@megumi/application/recommendation/content/prune-content';
import { createInterestManagement } from '@megumi/application/recommendation/interests/manage-interests';
import { createInterestStorage } from '@megumi/application/recommendation/interests/interest-storage';
import {
  createDatabase,
  migrateDatabase,
  type DatabaseConnection,
} from '@megumi/application/storage/index';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1_000;
const THRESHOLDS = {
  minimumCount: 2,
  targetCount: 10,
  interestMinimumCount: 1,
  interestTargetCount: 5,
};

describe('interest management', () => {
  let database: DatabaseConnection;
  let sequence = 0;
  let management: ReturnType<typeof createInterestManagement>;

  beforeEach(() => {
    database = openDatabase();
    sequence = 0;
    management = createInterestManagement({
      storage: createInterestStorage(database),
      newInterestId: () => `i${++sequence}`,
      now: () => NOW,
    });
  });

  afterEach(() => database.close());

  it('creates, updates, and deletes interests without touching content', async () => {
    const created = await management.createInterest({ text: '摄影' });
    expect(created.status).toBe('created');
    if (created.status !== 'created') throw new Error('expected a created interest');

    const updated = await management.updateInterest({ id: created.interest.id, enabled: false });
    expect(updated.status).toBe('updated');
    if (updated.status !== 'updated') throw new Error('expected an updated interest');
    expect(updated.interest.enabled).toBe(false);

    const missing = await management.updateInterest({ id: 'unknown', text: 'x' });
    expect(missing.status).toBe('not_found');

    const deleted = await management.deleteInterest({ id: created.interest.id });
    expect(deleted.status).toBe('deleted');
    expect((await management.listInterests()).interests).toEqual([]);
  });

  it('reports an empty description as an invalid request without writing', async () => {
    const result = await management.createInterest({ text: '   ' });

    expect(result.status).toBe('invalid_request');
    expect(countRows(database, 'interests')).toBe(0);
  });
});

describe('pool qualification', () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = openDatabase();
  });

  afterEach(() => database.close());

  it('keeps only candidates inside the daily freshness window', () => {
    seedInterest(database, 'i1');
    seedContentWithAnalysis(database, 'fresh', NOW - DAY, 'learning');
    seedContentWithAnalysis(database, 'stale', NOW - 30 * DAY, 'learning');
    seedCandidate(database, 'fresh', 'daily', NOW + 6 * DAY);
    seedCandidate(database, 'stale', 'daily', NOW - 23 * DAY);
    seedMatch(database, 'fresh', 'i1', 'direct');
    seedMatch(database, 'stale', 'i1', 'direct');

    const evaluation = evaluatePool(dependencies(database), input('daily'));

    expect(evaluation.snapshot.candidates.map((candidate) => candidate.contentId)).toEqual(['fresh']);
    expect(evaluation.health.activeCandidates).toBe(1);
    expect(evaluation.health.supplyLevel).toBe('low');
  });

  it('returns one member per duplicate group and prefers the representative', () => {
    seedInterest(database, 'i1');
    for (const id of ['dup-a', 'dup-b']) {
      seedContentWithAnalysis(database, id, NOW - DAY, 'learning');
      seedCandidate(database, id, 'daily', NOW + 6 * DAY);
      seedMatch(database, id, 'i1', 'direct');
    }
    database
      .prepare({ sql: "UPDATE contents SET duplicate_group_id = 'dup-a', duplicate_confidence = 1 WHERE id = 'dup-b'" })
      .run();

    const evaluation = evaluatePool(dependencies(database), input('daily'));

    expect(evaluation.snapshot.candidates).toHaveLength(1);
    expect(evaluation.snapshot.candidates[0].contentId).toBe('dup-a');
    expect(evaluation.snapshot.candidates[0].duplicateContentIds).toEqual(['dup-a', 'dup-b']);
  });

  it('leaves long-term candidates out when the content has no long-term value', () => {
    seedInterest(database, 'i1');
    seedContentWithAnalysis(database, 'c1', NOW - 400 * DAY, 'none');
    seedCandidate(database, 'c1', 'long_term', null);
    seedMatch(database, 'c1', 'i1', 'direct');

    const evaluation = evaluatePool(dependencies(database), input('long_term'));

    expect(evaluation.snapshot.candidates).toEqual([]);
  });
});

describe('content pruning', () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = openDatabase();
    seedInterest(database, 'i1');
  });

  afterEach(() => database.close());

  it('removes content with no active pool relation and no retention', async () => {
    seedContentWithAnalysis(database, 'c1', NOW - DAY, 'learning');

    const outcome = await pruneUnusedContent(
      { database, contents: createContentStorage(database), retention: { findRetainedContentIds: async () => [] } },
      { batchSize: 10 },
    );

    expect(outcome.removedContents).toBe(1);
    expect(countRows(database, 'contents')).toBe(0);
  });

  it('keeps content that a business record still references', async () => {
    seedContentWithAnalysis(database, 'c1', NOW - DAY, 'learning');

    const outcome = await pruneUnusedContent(
      {
        database,
        contents: createContentStorage(database),
        retention: { findRetainedContentIds: async (ids) => ids },
      },
      { batchSize: 10 },
    );

    expect(outcome.retainedContents).toBe(1);
    expect(countRows(database, 'contents')).toBe(1);
  });

  it('keeps content that still has a matching pool relation', async () => {
    seedContentWithAnalysis(database, 'c1', NOW - DAY, 'learning');
    seedCandidate(database, 'c1', 'daily', NOW + 6 * DAY);

    const outcome = await pruneUnusedContent(
      { database, contents: createContentStorage(database), retention: { findRetainedContentIds: async () => [] } },
      { batchSize: 10 },
    );

    expect(outcome.removedContents).toBe(0);
    expect(countRows(database, 'contents')).toBe(1);
  });
});

function openDatabase(): DatabaseConnection {
  const database = createDatabase({ filename: ':memory:' });
  migrateDatabase({ database });
  return database;
}

function dependencies(database: DatabaseConnection) {
  return { database, candidates: createCandidateStorage(database) };
}

function input(pool: 'daily' | 'long_term') {
  return {
    pool,
    interests: [{ id: 'i1', text: '摄影', enabled: true }],
    usage: { revision: 'rev-1', excludedContentIds: [] },
    requirement: { pool, minimumCount: 2, coverage: [{ interestId: 'i1', minimumCount: 1 }] },
    thresholds: THRESHOLDS,
    freshnessDays: 7,
    now: NOW,
  };
}

function seedInterest(database: DatabaseConnection, id: string): void {
  database
    .prepare({
      sql: 'INSERT INTO interests (id, text, enabled, created_at, updated_at) VALUES (?, ?, 1, 0, 0)',
    })
    .run([id, `interest ${id}`]);
}

function seedContentWithAnalysis(
  database: DatabaseConnection,
  id: string,
  publishedAt: number,
  longTermValue: string,
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
                    'article', 0.6, 0.1, ?, 'ready', 1, 0)`,
    })
    .run([id, longTermValue]);
}

function seedCandidate(
  database: DatabaseConnection,
  contentId: string,
  pool: string,
  expiresAt: number | null,
): void {
  database
    .prepare({
      sql: `INSERT INTO recommendation_candidates (pool, content_id, status, expires_at, created_at, updated_at)
            VALUES (?, ?, 'active', ?, 0, 0)`,
    })
    .run([pool, contentId, expiresAt]);
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

function countRows(database: DatabaseConnection, table: string): number {
  const rows = database
    .prepare<{ total: number }>({ sql: `SELECT count(*) AS total FROM ${table}` })
    .all();
  return rows[0]?.total ?? 0;
}
