/*
 * Verifies what saving `enabled: false` and then `enabled: true` does to one
 * interest's saved relation versions, to the other interests, and to the shared content
 * that both interests are matched against.
 */
// @vitest-environment node
import { createCandidateStorage } from '@megumi/application/recommendation/candidates/candidate-storage';
import type { CandidateSnapshot } from '@megumi/application/recommendation/candidates/candidate-contracts';
import { createContentStorage } from '@megumi/application/recommendation/content/content-storage';
import { createInterestManagement } from '@megumi/application/recommendation/interests/manage-interests';
import type { InterestManagement } from '@megumi/application/recommendation/interests/interest-contracts';
import { createInterestStorage } from '@megumi/application/recommendation/interests/interest-storage';
import { createCandidateSupply } from '@megumi/application/recommendation/supply/create-supply';
import type { SupplyExecutionConfig } from '@megumi/application/recommendation/supply/read-supply-config';
import type {
  CandidateRequirement,
  CandidateSupply,
  UsageReader,
} from '@megumi/application/recommendation/supply/supply-contracts';
import { CandidateSupplyConfigurationSchema } from '@megumi/application/settings/definitions/discovery';
import {
  createDatabase,
  migrateDatabase,
  type DatabaseConnection,
} from '@megumi/application/storage/index';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1_000;

const configuration = CandidateSupplyConfigurationSchema.parse({});
const config: SupplyExecutionConfig = {
  daily: configuration.daily,
  longTerm: configuration.longTerm,
  freshnessDays: configuration.freshnessDays,
  maintenanceIntervalMinutes: configuration.maintenanceIntervalMinutes,
  contentLanguages: configuration.contentLanguages,
  searchHistoryDays: configuration.searchHistoryDays,
  searchReuseIntervalMinutes: configuration.searchReuseIntervalMinutes,
  maxSearchBackoffHours: configuration.maxSearchBackoffHours,
  limits: configuration.limits,
};

describe('disabling and re-enabling one interest', () => {
  let database: DatabaseConnection;
  let interests: InterestManagement;
  let supply: CandidateSupply;

  beforeEach(() => {
    database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
    seedInterest(database, 'i1', 'Rust 异步运行时');
    seedInterest(database, 'i2', '摄影后期');
    seedDailyCandidate(database, 'c1', 'i1');
    seedDailyCandidate(database, 'c2', 'i2');

    interests = createInterestManagement({
      storage: createInterestStorage(database),
      newInterestId: () => 'generated',
      now: () => NOW,
    });
    const contents = createContentStorage(database);
    const candidates = createCandidateStorage(database);
    const usage: UsageReader = {
      async readUsageSnapshot() {
        return { revision: 'rev-1', excludedContentIds: [] };
      },
    };
    supply = createCandidateSupply({
      local: { database, contents, candidates, usage, interests, now: () => NOW },
      readConfig: async () => ({ status: 'ok', config }),
      // This test only reads saved candidates; no round may start.
      openRound: async () => ({
        status: 'unavailable',
        code: 'DISABLED',
        message: 'this test reads saved candidates only',
      }),
      newId: (prefix) => `${prefix}-1`,
    });
  });

  afterEach(() => database.close());

  it('stops counting a disabled interest at once and does not restore its relations when it is enabled again', async () => {
    const requirement: CandidateRequirement = {
      pool: 'daily',
      minimumCount: 1,
      coverage: [{ interestId: 'i1', minimumCount: 1 }],
    };

    const before = await supply.listCandidates({ requirement });
    expect(before.counts.total).toBe(2);
    expect(countFor(before, 'i1')).toBe(1);
    expect(countFor(before, 'i2')).toBe(1);

    const disabled = await interests.updateInterest({ interestId: 'i1', expectedRevision: 1, enabled: false });
    expect(disabled.status).toBe('updated');
    expect(savedMatches(database, 'i1')).toBe(1);

    // The very next read excludes the disabled interest, without waiting for a
    // maintenance round to tidy anything up.
    const whileDisabled = await supply.listCandidates({ requirement });
    expect(whileDisabled.counts.total).toBe(1);
    expect(countFor(whileDisabled, 'i1')).toBe(0);
    expect(countFor(whileDisabled, 'i2')).toBe(1);

    const reEnabled = await interests.updateInterest({ interestId: 'i1', expectedRevision: 2, enabled: true });
    expect(reEnabled.status).toBe('updated');

    // Re-enabling restores the interest itself, not the older relation versions: the content has to be judged against it again.
    const whileEnabled = await supply.listCandidates({ requirement });
    expect(whileEnabled.counts.total).toBe(1);
    expect(countFor(whileEnabled, 'i1')).toBe(0);
    expect(savedMatches(database, 'i1')).toBe(1);

    // The other interest and the shared content facts are untouched.
    expect(savedMatches(database, 'i2')).toBe(1);
    expect(countFor(whileEnabled, 'i2')).toBe(1);
    expect(countRows(database, 'contents')).toBe(2);
    expect(countRows(database, 'content_analysis')).toBe(2);
    expect(analysisStatus(database, 'c1')).toBe('ready');
  });
});

function countFor(snapshot: CandidateSnapshot, interestId: string): number {
  return snapshot.counts.byInterest.find((entry) => entry.interestId === interestId)?.count ?? 0;
}

function savedMatches(database: DatabaseConnection, interestId: string): number {
  const rows = database
    .prepare<{ total: number }>({
      sql: 'SELECT count(*) AS total FROM content_interest_matches WHERE interest_id = ?',
    })
    .all([interestId]);
  return rows[0]?.total ?? 0;
}

function countRows(database: DatabaseConnection, table: string): number {
  const rows = database
    .prepare<{ total: number }>({ sql: `SELECT count(*) AS total FROM ${table}` })
    .all();
  return rows[0]?.total ?? 0;
}

function analysisStatus(database: DatabaseConnection, contentId: string): string | undefined {
  return database
    .prepare<{ status: string }>({ sql: 'SELECT status FROM content_analysis WHERE content_id = ?' })
    .get([contentId])?.status;
}

function seedInterest(database: DatabaseConnection, id: string, text: string): void {
  database
    .prepare({
      sql: 'INSERT INTO interests (id, text, enabled, created_at, updated_at) VALUES (?, ?, 1, 0, 0)',
    })
    .run([id, text]);
}

/** One recent content that is analyzed, matched to one interest, and in the daily pool. */
function seedDailyCandidate(
  database: DatabaseConnection,
  contentId: string,
  interestId: string,
): void {
  database
    .prepare({
      sql: `INSERT INTO contents (id, source, canonical_url, text, published_at, created_at, updated_at)
            VALUES (?, 'zhihu', ?, '材料正文', ?, 0, 0)`,
    })
    .run([contentId, `https://example.com/${contentId}`, NOW - DAY]);
  database
    .prepare({
      sql: `INSERT INTO content_analysis
              (content_id, summary, key_points, topics, entities, content_type, quality_score,
               spam_score, long_term_value, status, attempts, analyzed_at)
            VALUES (?, '摘要', '[{"text":"要点","evidence":"材料正文"}]', '["主题"]', '["实体"]',
                    'article', 0.6, 0.1, 'learning', 'ready', 1, 0)`,
    })
    .run([contentId]);
  database
    .prepare({
      sql: `INSERT INTO content_interest_matches (content_id, interest_id, relation, matched_at)
            VALUES (?, ?, 'direct', 0)`,
    })
    .run([contentId, interestId]);
  database
    .prepare({
      sql: `INSERT INTO recommendation_candidates
              (pool, content_id, status, inactive_reason, expires_at, created_at, updated_at)
            VALUES ('daily', ?, 'active', NULL, ?, 0, 0)`,
    })
    .run([contentId, NOW - DAY + config.freshnessDays * DAY]);
}
