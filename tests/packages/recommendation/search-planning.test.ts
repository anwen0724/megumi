/* Verifies search planning keeps only runnable items and execution honours its limits. */
// @vitest-environment node
import { createModels, fauxAssistantMessage, fauxProvider, type Api, type Model } from '@megumi/ai';
import { needsSearchPlanning, planSearches } from '@megumi/application/recommendation/discovery/plan-searches';
import { executePlannedSearch } from '@megumi/application/recommendation/discovery/execute-searches';
import { createSearchStorage } from '@megumi/application/recommendation/discovery/search-storage';
import { createExecutionBudget } from '@megumi/application/recommendation/supply/execution-budget';
import { CandidateSupplyConfigurationSchema } from '@megumi/application/settings/definitions/discovery';
import type { SourceConnector } from '@megumi/application/recommendation/sources/source-connector';
import {
  createDatabase,
  migrateDatabase,
  type DatabaseConnection,
} from '@megumi/application/storage/index';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubDescriptor } from './source-fixture';

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1_000;
const limits = CandidateSupplyConfigurationSchema.parse({}).limits;

describe('search planning', () => {
  let database: DatabaseConnection;
  let faux: ReturnType<typeof fauxProvider>;
  let models: ReturnType<typeof createModels>;
  let model: Model<Api>;
  let sequence = 0;

  beforeEach(() => {
    sequence = 0;
    database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
    seedInterest(database, 'i1');
    seedQuery(database, 'q1', 'i1', '摄影');
    faux = fauxProvider({ models: [{ id: 'faux-supply' }] });
    models = createModels();
    models.setProvider(faux.provider);
    const resolved = models.getModel(faux.provider.id, 'faux-supply');
    if (!resolved) throw new Error('expected the faux model to be registered');
    model = resolved;
  });

  afterEach(() => database.close());

  it('drops items that cite unknown interests, sources, or queries and fills the request itself', async () => {
    faux.setResponses([
      fauxAssistantMessage(
        JSON.stringify({
          items: [
            { interestId: 'i1', pools: ['daily'], source: 'zhihu', priority: 1, queryId: 'q1' },
            { interestId: 'unknown', pools: ['daily'], source: 'zhihu', priority: 2 },
            { interestId: 'i1', pools: ['daily'], source: 'bilibili', priority: 3 },
            { interestId: 'i1', pools: ['daily'], source: 'zhihu', priority: 4, queryId: 'q-missing' },
          ],
        }),
      ),
    ]);

    const outcome = await planSearches(
      { database, client: models },
      planningInput(model, { interests: [{ id: 'i1', text: '摄影', enabled: true }] }),
    );

    expect(outcome.status).toBe('planned');
    if (outcome.status !== 'planned') throw new Error('expected a plan');
    expect(outcome.items).toHaveLength(1);
    // The program fills both values from the source declaration, not the model.
    expect(outcome.items[0]?.limit).toBe(10);
    expect(outcome.items[0]?.timeRange).toEqual({ from: NOW - 7 * DAY, to: NOW });
    expect(outcome.invalidItems).toBe(3);
    expect(outcome.droppedItems).toBe(0);
  });

  it('leaves the time range off an item that serves only the long-term pool', async () => {
    faux.setResponses([
      fauxAssistantMessage(
        JSON.stringify({
          items: [
            { interestId: 'i1', pools: ['long_term'], source: 'zhihu', priority: 1, queryId: 'q1' },
          ],
        }),
      ),
    ]);

    const outcome = await planSearches(
      { database, client: models },
      planningInput(model, { interests: [{ id: 'i1', text: '摄影', enabled: true }] }),
    );

    expect(outcome.status).toBe('planned');
    if (outcome.status !== 'planned') throw new Error('expected a plan');
    expect(outcome.items[0]?.timeRange).toBeUndefined();
  });

  it('writes each identifier so the model can copy it back verbatim', async () => {
    const prompts: string[] = [];
    const client = {
      async completeSimple(
        _model: Model<Api>,
        context: { messages: readonly { content: unknown }[] },
      ) {
        prompts.push(String(context.messages[0]?.content));
        return fauxAssistantMessage(JSON.stringify({ items: [] }));
      },
    };

    const outcome = await planSearches(
      { database, client },
      planningInput(model, { interests: [{ id: 'interest:abc', text: 'Rust 异步运行时', enabled: true }] }),
    );

    expect(outcome.status).toBe('planned');
    // The id itself contains the separator the old plain-text line used, so the
    // prompt must delimit it as data.
    expect(prompts[0]).toContain('{"interestId":"interest:abc","text":"Rust 异步运行时"}');
    expect(prompts[0]).toContain('{"queryId":"q1","interestId":"i1","category":"core","query":"摄影"}');
  });

  it('plans only when a minimum gap or a waiting request exists', () => {
    const healthy = {
      pool: 'daily' as const,
      activeCandidates: 120,
      freshCandidates: 120,
      avgQuality: 0.5,
      newestPublishedAt: NOW,
      recentNewItems: 0,
      supplyLevel: 'healthy' as const,
      minimumDeficit: 0,
      targetDeficit: 80,
    };
    const low = { ...healthy, activeCandidates: 40, supplyLevel: 'low' as const, minimumDeficit: 60 };

    // Capacity above every minimum with nothing waiting must not spend a call.
    expect(needsSearchPlanning({ poolHealth: [healthy], hasPendingRequest: false })).toBe(false);
    expect(needsSearchPlanning({ poolHealth: [low], hasPendingRequest: false })).toBe(true);
    // A waiting generation request plans even when every pool is above its minimum.
    expect(needsSearchPlanning({ poolHealth: [healthy], hasPendingRequest: true })).toBe(true);
  });

  describe('execution', () => {
    function dependencies(source: SourceConnector) {
      return {
        database,
        source,
        storage: createSearchStorage(database),
        budget: createExecutionBudget({ limits, startedAt: NOW, now: () => NOW }),
        newQueryId: () => `q${++sequence}`,
        newResultId: () => `r${++sequence}`,
        newHistoryId: () => `h${++sequence}`,
        reuseIntervalMs: 6 * 60 * 60 * 1_000,
        cooldownMs: 5 * 60 * 1_000,
      };
    }

    it('skips a window that already ran inside the reuse interval', async () => {
      const source = stubSource({ items: [] });
      const once = dependencies(source);
      const item = { interestId: 'i1', source: 'zhihu', limit: 10, query: '摄影', now: NOW };

      expect((await executePlannedSearch(once, item)).status).toBe('success');
      const second = await executePlannedSearch(once, item);

      expect(second.status).toBe('skipped');
      if (second.status !== 'skipped') throw new Error('expected a skip');
      expect(second.reason).toBe('recent_duplicate');
      expect(countRows(database, 'search_history')).toBe(1);
    });

    it('records a throttled source, then skips it while it cools down', async () => {
      const throttled = stubSource({ failure: { code: 'rate_limited', message: '频率限制', retryable: true } });
      const once = dependencies(throttled);

      const first = await executePlannedSearch(once, {
        interestId: 'i1',
        source: 'zhihu',
        limit: 10,
        query: '摄影',
        now: NOW,
      });
      const second = await executePlannedSearch(once, {
        interestId: 'i1',
        source: 'zhihu',
        limit: 10,
        query: '摄影 后期',
        now: NOW + 1_000,
      });

      expect(first.status).toBe('failed');
      expect(second.status).toBe('skipped');
      if (second.status !== 'skipped') throw new Error('expected a skip');
      expect(second.reason).toBe('source_cooling');
      expect(historyOutcome(database)).toBe('failed');
    });

    it('reports a successful search with zero results as success, not failure', async () => {
      const once = dependencies(stubSource({ items: [] }));

      const outcome = await executePlannedSearch(once, {
        interestId: 'i1',
        source: 'zhihu',
        limit: 10,
        query: '摄影',
        now: NOW,
      });

      expect(outcome.status).toBe('success');
      if (outcome.status !== 'success') throw new Error('expected a success');
      expect(outcome.resultCount).toBe(0);
      expect(historyResultCount(database)).toBe(0);
      expect(historyOutcome(database)).toBe('success');
    });

    it('stops before the source call when the round budget is spent', async () => {
      let called = false;
      const source = stubSource({ items: [], onCall: () => { called = true; } });
      const exhausted = dependencies(source);
      exhausted.budget.reserve('searchCalls');
      for (let index = 1; index < limits.maxSearchCalls; index += 1) exhausted.budget.reserve('searchCalls');

      const outcome = await executePlannedSearch(exhausted, {
        interestId: 'i1',
        source: 'zhihu',
        limit: 10,
        query: '摄影',
        now: NOW,
      });

      expect(outcome.status).toBe('skipped');
      if (outcome.status !== 'skipped') throw new Error('expected a skip');
      expect(outcome.reason).toBe('budget');
      expect(called).toBe(false);
    });
  });
});

/** One planning input, so each test only states what it changes. */
function planningInput(
  model: Model<Api>,
  overrides: Partial<Parameters<typeof planSearches>[1]> = {},
): Parameters<typeof planSearches>[1] {
  return {
    interests: [],
    poolHealth: [],
    pendingGaps: [],
    recentSearches: [],
    sources: [stubDescriptor],
    model,
    maxInputTokens: 10_000,
    maxOutputTokens: 1_000,
    maxResultsPerSearch: 10,
    maxItems: 5,
    now: NOW,
    freshnessDays: 7,
    ...overrides,
  };
}

function stubSource(options: {  items?: readonly { source: string; url: string; text?: string }[];
  failure?: { code: string; message: string; retryable: boolean };
  onCall?: () => void;
}): SourceConnector {
  return {
    id: 'zhihu',
    descriptor: stubDescriptor,
    async search() {
      options.onCall?.();
      if (options.failure) {
        return {
          status: 'failed',
          failure: {
            code: options.failure.code as never,
            message: options.failure.message,
            retryable: options.failure.retryable,
          },
        };
      }
      return { status: 'success', items: options.items ?? [] };
    },
    async fetch() {
      return { status: 'failed', failure: { code: 'material_unavailable', message: 'unsupported', retryable: false } };
    },
  };
}

function seedInterest(database: DatabaseConnection, id: string): void {
  database
    .prepare({
      sql: 'INSERT INTO interests (id, text, enabled, created_at, updated_at) VALUES (?, ?, 1, 0, 0)',
    })
    .run([id, `interest ${id}`]);
}

function seedQuery(database: DatabaseConnection, id: string, interestId: string, query: string): void {
  database
    .prepare({
      sql: `INSERT INTO search_queries (id, interest_id, query, category, origin, status, created_at)
            VALUES (?, ?, ?, 'core', 'ai', 'active', 0)`,
    })
    .run([id, interestId, query]);
}

function historyOutcome(database: DatabaseConnection): string | undefined {
  return database
    .prepare<{ outcome: string }>({ sql: 'SELECT outcome FROM search_history ORDER BY searched_at DESC LIMIT 1' })
    .get()?.outcome;
}

function historyResultCount(database: DatabaseConnection): number | null | undefined {
  return database
    .prepare<{ result_count: number | null }>({
      sql: 'SELECT result_count FROM search_history ORDER BY searched_at DESC LIMIT 1',
    })
    .get()?.result_count;
}

function countRows(database: DatabaseConnection, table: string): number {
  const rows = database
    .prepare<{ total: number }>({ sql: `SELECT count(*) AS total FROM ${table}` })
    .all();
  return rows[0]?.total ?? 0;
}
