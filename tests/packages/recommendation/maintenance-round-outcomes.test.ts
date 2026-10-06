/*
 * Verifies what one maintenance round reports and leaves behind: whether it
 * ended with the minimums or the targets met, which gaps it gives the search
 * planner, and what happens when its commit cannot be written at all.
 */
// @vitest-environment node
import { createModels, fauxAssistantMessage, fauxProvider } from '@megumi/ai';
import type { TextModelClient } from '@megumi/application/recommendation/call-text-model';
import { createCandidateStorage } from '@megumi/application/recommendation/candidates/candidate-storage';
import { createContentStorage } from '@megumi/application/recommendation/content/content-storage';
import { createSearchStorage } from '@megumi/application/recommendation/discovery/search-storage';
import { createInterestManagement } from '@megumi/application/recommendation/interests/manage-interests';
import { createInterestStorage } from '@megumi/application/recommendation/interests/interest-storage';
import type { SourceConnector } from '@megumi/application/recommendation/sources/source-connector';
import { createCandidateSupply } from '@megumi/application/recommendation/supply/create-supply';
import type { SupplyExecutionConfig } from '@megumi/application/recommendation/supply/read-supply-config';
import type {
  CandidateRequirement,
  CandidateSupply,
  UsageReader,
} from '@megumi/application/recommendation/supply/supply-contracts';
import {
  CandidateSupplyConfigurationSchema,
  type CandidatePoolThresholds,
} from '@megumi/application/settings/definitions/discovery';
import {
  createDatabase,
  migrateDatabase,
  type DatabaseConnection,
  type DatabaseRow,
  type DatabaseStatement,
  type DatabaseTransactionRequest,
  type PrepareDatabaseStatementRequest,
} from '@megumi/application/storage/index';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1_000;
const MATERIAL = 'Tokio 运行时提供异步任务调度与超时控制，这段文本用于关键点证据比对。';
const INJECTED_FAILURE = 'injected candidate commit failure';
const POOL_RELATION_INSERT = /insert\s+into\s+recommendation_candidates\b/iu;

describe('what a finished round reports', () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
    seedInterest(database, 'i1');
  });

  afterEach(() => database.close());

  it('reports minimums_met for a pool at or above its minimum but below its target', async () => {
    const pool = composePool(database, {
      daily: { minimumCount: 1, targetCount: 5, interestMinimumCount: 0, interestTargetCount: 1 },
      longTerm: { minimumCount: 1, targetCount: 5, interestMinimumCount: 0, interestTargetCount: 1 },
    });
    seedCandidate(database, 'c1', 'i1', { pools: ['daily', 'long_term'] });

    const result = await pool.supply.startMaintenance({ reason: 'startup' }).result;

    expect(result.stopReason).toBe('minimums_met');
    expect(result.poolHealth.every((health) => health.minimumDeficit === 0)).toBe(true);
    expect(result.poolHealth.some((health) => health.targetDeficit > 0)).toBe(true);
  });

  it('reports targets_met for a pool that reached its target', async () => {
    const pool = composePool(database, {
      daily: { minimumCount: 1, targetCount: 5, interestMinimumCount: 0, interestTargetCount: 1 },
      longTerm: { minimumCount: 1, targetCount: 5, interestMinimumCount: 0, interestTargetCount: 1 },
    });
    for (let index = 1; index <= 5; index += 1) {
      seedCandidate(database, `c${index}`, 'i1', { pools: ['daily', 'long_term'] });
    }

    const result = await pool.supply.startMaintenance({ reason: 'startup' }).result;

    expect(result.stopReason).toBe('targets_met');
    expect(result.poolHealth.every((health) => health.targetDeficit === 0)).toBe(true);
  });

  it('gives the planner the per-interest deficits, not only the whole-pool total', async () => {
    const pool = composePool(database, {
      daily: { minimumCount: 2, targetCount: 4, interestMinimumCount: 1, interestTargetCount: 2 },
      longTerm: { minimumCount: 0, targetCount: 1, interestMinimumCount: 0, interestTargetCount: 1 },
    });
    seedInterest(database, 'i2');
    // The pool total is short by one, and the content that closed part of it
    // belongs to i2 alone: i1 is at zero and only a per-interest line shows it.
    seedCandidate(database, 'c1', 'i2', { pools: ['daily'], longTermValue: 'none' });

    const result = await pool.supply.startMaintenance({ reason: 'startup' }).result;

    expect(result.status).toBe('completed');
    expect(pool.planPrompts).toHaveLength(1);
    const prompt = pool.planPrompts[0] ?? '';
    expect(prompt, prompt).toContain('- daily / i1: active=0 minimumDeficit=1');
    expect(prompt, prompt).toContain('- daily / i2: active=1 minimumDeficit=0');
  });
});

describe('a round whose commit cannot be written', () => {
  let outcome: CommitFixture;

  beforeEach(() => {
    outcome = openCommitFixture();
  });

  afterEach(async () => {
    await outcome.finish();
  });

  it('rejects instead of reporting an unsatisfied round, leaves no half relations, and recovers from what was saved', async () => {
    const requirement: CandidateRequirement = { pool: 'daily', minimumCount: 1, coverage: [] };
    outcome.failNextPoolRelationWrite();

    const waiting = outcome.supply.prepareCandidates({ requirement });
    const round = outcome.supply.startMaintenance({ reason: 'startup' });
    // Observed as soon as it settles, so an earlier assertion cannot leave an
    // unhandled rejection; what the caller must receive is asserted at the end.
    const waitingOutcome = waiting.then(
      (result) => ({ status: 'resolved' as const, result }),
      (error: unknown) => ({ status: 'rejected' as const, error }),
    );

    await expect(round.result).rejects.toThrow(INJECTED_FAILURE);

    // The transaction wrote neither the interest relation nor the pool relation,
    // so no content is left holding half a candidate.
    expect(countRows(outcome.database, 'recommendation_candidates')).toBe(0);
    expect(halfCommittedRelations(outcome.database)).toBe(0);
    expect(countRows(outcome.database, 'content_interest_matches')).toBe(0);
    // The material and its analysis were saved before the commit, so the next
    // round can finish the work without searching or analyzing again.
    expect(countRows(outcome.database, 'contents')).toBe(1);
    expect(analysisStatus(outcome.database)).toBe('ready');

    outcome.stopFailing();
    const recovered = await outcome.supply.startMaintenance({ reason: 'periodic' }).result;

    expect(recovered.status).toBe('completed');
    expect(recovered.savedCounts.discoveredItems).toBe(0);
    expect(recovered.savedCounts.analyzedContents).toBe(0);
    expect(outcome.sourceSearchCalls).toBe(1);
    const snapshot = await outcome.supply.listCandidates({ requirement });
    expect(snapshot.counts.total).toBe(1);
    expect(snapshot.candidates[0]?.interestMatches).toEqual([
      { interestId: 'i1', relation: 'direct', basis: '直接讨论 Tokio' },
    ]);

    // A storage failure is not a business shortage: the caller learns the truth
    // through the rejected promise, not through an `insufficient` result.
    await expect(
      waitingOutcome,
      'the waiting caller must see the failed commit instead of an insufficient result',
    ).resolves.toEqual({ status: 'rejected', error: expect.any(Error) });
  });
});

interface PoolFixture {
  readonly supply: CandidateSupply;
  readonly planPrompts: readonly string[];
}

/** Composes the real supply over one Database with the given pool thresholds. */
function composePool(
  database: DatabaseConnection,
  thresholds: { readonly daily: CandidatePoolThresholds; readonly longTerm: CandidatePoolThresholds },
): PoolFixture {
  const configuration = CandidateSupplyConfigurationSchema.parse({
    daily: thresholds.daily,
    longTerm: thresholds.longTerm,
  });
  const config: SupplyExecutionConfig = {
    daily: configuration.daily,
    longTerm: configuration.longTerm,
    freshnessDays: configuration.freshnessDays,
    maintenanceIntervalMinutes: configuration.maintenanceIntervalMinutes,
    contentLanguages: configuration.contentLanguages,
    searchHistoryDays: configuration.searchHistoryDays,
    searchReuseIntervalMinutes: configuration.searchReuseIntervalMinutes,
    limits: configuration.limits,
  };
  const interests = createInterestManagement({
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
  const planPrompts: string[] = [];
  const client: TextModelClient = {
    async completeSimple(_model, context) {
      const systemPrompt = context.systemPrompt ?? '';
      if (systemPrompt.includes('You plan searches')) {
        planPrompts.push(String(context.messages[0]?.content ?? ''));
        return fauxAssistantMessage(JSON.stringify({ items: [] }));
      }
      throw new Error(`unexpected model task: ${systemPrompt.slice(0, 40)}`);
    },
  };
  const source: SourceConnector = {
    id: 'zhihu',
    async search() {
      return { status: 'success', items: [] };
    },
    async fetch() {
      return {
        status: 'failed',
        failure: { code: 'material_unavailable', message: 'not used', retryable: false },
      };
    },
  };
  const faux = fauxProvider({ models: [{ id: 'faux-supply' }] });
  const models = createModels();
  models.setProvider(faux.provider);
  const model = models.getModel(faux.provider.id, 'faux-supply');
  if (!model) throw new Error('expected the faux model to be registered');

  let sequence = 0;
  const newId = (prefix: string) => `${prefix}-${++sequence}`;
  const supply = createCandidateSupply({
    local: { database, contents, candidates, usage, interests, now: () => NOW },
    readConfig: async () => ({ status: 'ok', config }),
    openRound: async () => ({
      status: 'ok',
      model,
      dependencies: {
        config,
        database,
        model,
        source,
        client,
        interests,
        contents,
        candidates,
        search: createSearchStorage(database),
        usage,
        retention: { findRetainedContentIds: async () => [] },
        newId,
        now: () => NOW,
      },
    }),
    newId,
  });

  return { supply, planPrompts };
}

interface CommitFixture {
  readonly supply: CandidateSupply;
  readonly database: DatabaseConnection;
  readonly sourceSearchCalls: number;
  failNextPoolRelationWrite(): void;
  stopFailing(): void;
  finish(): Promise<void>;
}

/**
 * Composes the real supply over one Database whose pool-relation write can be
 * failed on request. Everything else keeps running on the real connection, so
 * the round reaches its commit phase for real.
 */
function openCommitFixture(): CommitFixture {
  const connection = createDatabase({ filename: ':memory:' });
  migrateDatabase({ database: connection });
  const injected = injectCommitFailure(connection);
  const database = injected.database;

  seedInterest(database, 'i1');
  const interests = createInterestManagement({
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
  const counters = { sourceSearchCalls: 0 };
  const client: TextModelClient = {
    async completeSimple(_model, context) {
      const systemPrompt = context.systemPrompt ?? '';
      const prompt = String(context.messages[0]?.content ?? '');
      if (systemPrompt.includes('You plan searches')) {
        return fauxAssistantMessage(
          JSON.stringify({
            items: [
              {
                interestId: 'i1',
                pools: ['daily'],
                source: 'zhihu',
                priority: 1,
                limit: 5,
                query: 'Rust 异步运行时',
                category: 'core',
              },
            ],
          }),
        );
      }
      if (systemPrompt.includes('You analyze exactly one source document')) {
        return fauxAssistantMessage(analysisJson());
      }
      if (systemPrompt.includes('You judge how each listed interest')) {
        const contentId = /\[contentId=([^\]]+)\]/u.exec(prompt)?.[1];
        if (!contentId) throw new Error('the matching prompt listed no content id');
        return fauxAssistantMessage(
          JSON.stringify({
            matches: [
              { contentId, interestId: 'i1', relation: 'direct', basis: '直接讨论 Tokio' },
            ],
          }),
        );
      }
      throw new Error(`unexpected model task: ${systemPrompt.slice(0, 40)}`);
    },
  };
  const source: SourceConnector = {
    id: 'zhihu',
    async search() {
      counters.sourceSearchCalls += 1;
      return {
        status: 'success',
        items: [
          {
            source: 'zhihu',
            url: 'https://example.com/tokio',
            title: 'Tokio 概览',
            text: MATERIAL,
            publishedAt: NOW - DAY,
          },
        ],
      };
    },
    async fetch() {
      return {
        status: 'failed',
        failure: { code: 'material_unavailable', message: 'not used', retryable: false },
      };
    },
  };
  const faux = fauxProvider({ models: [{ id: 'faux-supply' }] });
  const models = createModels();
  models.setProvider(faux.provider);
  const model = models.getModel(faux.provider.id, 'faux-supply');
  if (!model) throw new Error('expected the faux model to be registered');

  const configuration = CandidateSupplyConfigurationSchema.parse({
    daily: { minimumCount: 1, targetCount: 3, interestMinimumCount: 0, interestTargetCount: 1 },
    longTerm: { minimumCount: 0, targetCount: 1, interestMinimumCount: 0, interestTargetCount: 1 },
  });
  const config: SupplyExecutionConfig = {
    daily: configuration.daily,
    longTerm: configuration.longTerm,
    freshnessDays: configuration.freshnessDays,
    maintenanceIntervalMinutes: configuration.maintenanceIntervalMinutes,
    contentLanguages: configuration.contentLanguages,
    searchHistoryDays: configuration.searchHistoryDays,
    searchReuseIntervalMinutes: configuration.searchReuseIntervalMinutes,
    limits: configuration.limits,
  };
  let sequence = 0;
  const newId = (prefix: string) => `${prefix}-${++sequence}`;
  const supply = createCandidateSupply({
    local: { database, contents, candidates, usage, interests, now: () => NOW },
    readConfig: async () => ({ status: 'ok', config }),
    openRound: async () => ({
      status: 'ok',
      model,
      dependencies: {
        config,
        database,
        model,
        source,
        client,
        interests,
        contents,
        candidates,
        search: createSearchStorage(database),
        usage,
        retention: { findRetainedContentIds: async () => [] },
        newId,
        now: () => NOW,
      },
    }),
    newId,
  });

  return {
    supply,
    database,
    get sourceSearchCalls() {
      return counters.sourceSearchCalls;
    },
    failNextPoolRelationWrite: injected.failNextPoolRelationWrite,
    stopFailing: injected.stopFailing,
    finish: async () => {
      await supply.close();
      connection.close();
    },
  };
}

/**
 * Wraps one real connection so the next pool-relation write can fail while
 * every other statement keeps running on the real connection.
 */
function injectCommitFailure(connection: DatabaseConnection): {
  readonly database: DatabaseConnection;
  failNextPoolRelationWrite(): void;
  stopFailing(): void;
} {
  let armed = false;
  const database: DatabaseConnection = {
    prepare<TRow extends DatabaseRow>(
      request: PrepareDatabaseStatementRequest,
    ): DatabaseStatement<TRow> {
      const statement = connection.prepare<TRow>(request);
      return {
        run(parameters) {
          if (armed && POOL_RELATION_INSERT.test(request.sql)) {
            armed = false;
            throw new Error(INJECTED_FAILURE);
          }
          return statement.run(parameters);
        },
        get: (parameters) => statement.get(parameters),
        all: (parameters) => statement.all(parameters),
      };
    },
    transaction<T>(request: DatabaseTransactionRequest<T>): T {
      return connection.transaction(request);
    },
    close() {
      connection.close();
    },
  };
  return {
    database,
    failNextPoolRelationWrite: () => {
      armed = true;
    },
    stopFailing: () => {
      armed = false;
    },
  };
}

function analysisJson(): string {
  return JSON.stringify({
    summary: 'Tokio 运行时简介',
    keyPoints: [{ text: '提供异步调度', evidence: 'Tokio 运行时提供异步任务调度与超时控制' }],
    topics: ['异步'],
    entities: ['Tokio'],
    contentType: 'article',
    qualityScore: 0.6,
    spamScore: 0.1,
    longTermValue: 'learning',
    matches: [{ interestId: 'i1', relation: 'direct', basis: '直接讨论 Tokio' }],
  });
}

function seedInterest(database: DatabaseConnection, id: string): void {
  database
    .prepare({
      sql: 'INSERT INTO interests (id, text, enabled, created_at, updated_at) VALUES (?, ?, 1, 0, 0)',
    })
    .run([id, `interest ${id}`]);
}

/** One recent, analyzed content matched to one interest and placed in the given pools. */
function seedCandidate(
  database: DatabaseConnection,
  contentId: string,
  interestId: string,
  input: { readonly pools: readonly string[]; readonly longTermValue?: string },
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
                    'article', 0.6, 0.1, ?, 'ready', 1, 0)`,
    })
    .run([contentId, input.longTermValue ?? 'learning']);
  database
    .prepare({
      sql: `INSERT INTO content_interest_matches (content_id, interest_id, relation, matched_at)
            VALUES (?, ?, 'direct', 0)`,
    })
    .run([contentId, interestId]);
  for (const pool of input.pools) {
    database
      .prepare({
        sql: `INSERT INTO recommendation_candidates
                (pool, content_id, status, inactive_reason, expires_at, created_at, updated_at)
              VALUES (?, ?, 'active', NULL, ?, 0, 0)`,
      })
      .run([pool, contentId, pool === 'daily' ? NOW - DAY + 7 * DAY : null]);
  }
}

/** Pool relations whose content has no current positive interest relation. */
function halfCommittedRelations(database: DatabaseConnection): number {
  const rows = database
    .prepare<{ total: number }>({
      sql: `SELECT count(*) AS total FROM recommendation_candidates rc
            WHERE NOT EXISTS (
              SELECT 1 FROM content_interest_matches m
              WHERE m.content_id = rc.content_id AND m.relation IN ('direct','related')
            )`,
    })
    .all();
  return rows[0]?.total ?? 0;
}

function analysisStatus(database: DatabaseConnection): string | undefined {
  return database
    .prepare<{ status: string }>({ sql: 'SELECT status FROM content_analysis LIMIT 1' })
    .get()?.status;
}

function countRows(database: DatabaseConnection, table: string): number {
  const rows = database
    .prepare<{ total: number }>({ sql: `SELECT count(*) AS total FROM ${table}` })
    .all();
  return rows[0]?.total ?? 0;
}
