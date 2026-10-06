/* Verifies the supply operations read locally, reject bad input, and close cleanly. */
// @vitest-environment node
import { createCandidateStorage } from '@megumi/application/recommendation/candidates/candidate-storage';
import { createContentStorage } from '@megumi/application/recommendation/content/content-storage';
import { createInterestManagement } from '@megumi/application/recommendation/interests/manage-interests';
import { createInterestStorage } from '@megumi/application/recommendation/interests/interest-storage';
import { createCandidateSupply } from '@megumi/application/recommendation/supply/create-supply';
import { CandidateSupplyConfigurationSchema } from '@megumi/application/settings/definitions/discovery';
import {
  createDatabase,
  migrateDatabase,
  type DatabaseConnection,
} from '@megumi/application/storage/index';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1_000;

describe('candidate supply operations', () => {
  let database: DatabaseConnection;
  let openRoundCalls = 0;
  let sequence = 0;
  let supply: ReturnType<typeof createCandidateSupply>;

  beforeEach(() => {
    openRoundCalls = 0;
    sequence = 0;
    database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
    const storage = createInterestStorage(database);
    const management = createInterestManagement({
      storage,
      newInterestId: () => `i${++sequence}`,
      now: () => NOW,
    });
    supply = createCandidateSupply({
      local: {
        database,
        contents: createContentStorage(database),
        candidates: createCandidateStorage(database),
        usage: { readUsageSnapshot: async () => ({ revision: 'rev-1', excludedContentIds: [] }) },
        interests: management,
        now: () => NOW,
      },
      readConfig: async () => ({ status: 'ok', config: config() }),
      openRound: async () => {
        openRoundCalls += 1;
        return { status: 'unavailable', code: 'DISABLED', message: 'not started in this test' };
      },
      newId: (prefix) => `${prefix}-${++sequence}`,
    });
  });

  afterEach(() => database.close());

  it('returns ready from saved candidates without opening a round', async () => {
    seedInterest(database, 'i1');
    seedCandidateWithAnalysis(database, 'c1', NOW - DAY, 'learning');

    const result = await supply.prepareCandidates({
      requirement: { pool: 'daily', minimumCount: 1, coverage: [] },
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('expected a ready snapshot');
    expect(result.snapshot.counts.total).toBe(1);
    expect(openRoundCalls).toBe(0);
  });

  it('reports invalid_request for a requirement the contract rejects', async () => {
    const result = await supply.prepareCandidates({
      requirement: { pool: 'daily', minimumCount: 0, coverage: [] },
    });

    expect(result.status).toBe('invalid_request');
    expect(openRoundCalls).toBe(0);
  });

  it('reports unavailable when no enabled interest exists', async () => {
    const result = await supply.prepareCandidates({
      requirement: { pool: 'daily', minimumCount: 1, coverage: [] },
    });

    expect(result.status).toBe('unavailable');
    if (result.status !== 'unavailable') throw new Error('expected unavailability');
    expect(result.code).toBe('NO_INTERESTS');
  });

  it('refuses new maintenance after close and tolerates repeated close', async () => {
    await supply.close();
    await supply.close();

    expect(() => supply.startMaintenance({ reason: 'startup' })).toThrow();
    const result = await supply.prepareCandidates({
      requirement: { pool: 'daily', minimumCount: 1, coverage: [] },
    });
    expect(result.status).toBe('unavailable');
    if (result.status !== 'unavailable') throw new Error('expected unavailability');
    expect(result.code).toBe('SERVICE_CLOSED');
  });
});

function config() {
  return CandidateSupplyConfigurationSchema.parse({});
}

function seedInterest(database: DatabaseConnection, id: string): void {
  database
    .prepare({
      sql: 'INSERT INTO interests (id, text, enabled, created_at, updated_at) VALUES (?, ?, 1, 0, 0)',
    })
    .run([id, `interest ${id}`]);
}

function seedCandidateWithAnalysis(
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
  database
    .prepare({
      sql: `INSERT INTO recommendation_candidates (pool, content_id, status, expires_at, created_at, updated_at)
            VALUES ('daily', ?, 'active', ?, 0, 0)`,
    })
    .run([id, publishedAt + 7 * DAY]);
  database
    .prepare({
      sql: `INSERT INTO content_interest_matches (content_id, interest_id, relation, matched_at)
            VALUES (?, 'i1', 'direct', 0)`,
    })
    .run([id]);
}
