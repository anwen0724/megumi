/*
 * Verifies search backoff: a round that searched an interest and pool without
 * gaining an effective candidate waits longer before its next search, while a
 * productive round clears the wait. Backoff only slows searches down; it never
 * relaxes a threshold and never hides a gap a waiting request still has.
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createModels, fauxAssistantMessage, fauxProvider, type Api, type Context, type Model } from '@megumi/ai';
import type { CandidatePool } from '@megumi/application/recommendation/candidates/candidate-contracts';
import { createCandidateStorage } from '@megumi/application/recommendation/candidates/candidate-storage';
import { createContentStorage } from '@megumi/application/recommendation/content/content-storage';
import { createSearchStorage, type SearchBackoffRecord } from '@megumi/application/recommendation/discovery/search-storage';
import { createInterestManagement } from '@megumi/application/recommendation/interests/manage-interests';
import { createInterestStorage } from '@megumi/application/recommendation/interests/interest-storage';
import type { SourceConnector } from '@megumi/application/recommendation/sources/source-connector';
import { createCandidateSupply } from '@megumi/application/recommendation/supply/create-supply';
import type { SupplyExecutionConfig } from '@megumi/application/recommendation/supply/read-supply-config';
import { CandidateSupplyConfigurationSchema } from '@megumi/application/settings/definitions/discovery';
import {
  createDatabase,
  migrateDatabase,
  type DatabaseConnection,
} from '@megumi/application/storage/index';
import { stubDescriptor } from './source-fixture';

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1_000;
const INTEREST_ID = 'i1';
const INTEREST_TEXT = 'Rust 异步运行时';
const MATERIAL = 'Tokio 运行时提供异步任务调度与超时控制，这段文本用于关键点证据比对。';

/** The schema that owns these defaults, so no test invents one of its own. */
const configuration = CandidateSupplyConfigurationSchema.parse({});

describe('search backoff', () => {
  it('waits twice as long after every search that finds nothing new', async () => {
    const round = open();
    const firstWait = 2 * 60 * 60 * 1_000;

    expect(await round.run()).toBe('searched');
    expect(round.backoffFor('daily')).toEqual({
      interestId: INTEREST_ID,
      interestText: INTEREST_TEXT,
      pool: 'daily',
      consecutiveLowYieldRounds: 1,
      nextAllowedAt: NOW + firstWait,
    });
    // One search served both pools, so both carry the wait.
    expect(round.backoff()).toEqual([
      {
        interestId: INTEREST_ID,
        interestText: INTEREST_TEXT,
        pool: 'daily',
        consecutiveLowYieldRounds: 1,
        nextAllowedAt: NOW + firstWait,
      },
      {
        interestId: INTEREST_ID,
        interestText: INTEREST_TEXT,
        pool: 'long_term',
        consecutiveLowYieldRounds: 1,
        nextAllowedAt: NOW + firstWait,
      },
    ]);

    // Still inside the wait, so this round does not search again.
    round.advance(30 * 60 * 1_000);
    expect(await round.run()).toBe('held_back');

    round.advanceTo(NOW + firstWait);
    expect(await round.run()).toBe('searched');
    expect(round.backoffFor('daily')).toEqual({
      interestId: INTEREST_ID,
      interestText: INTEREST_TEXT,
      pool: 'daily',
      consecutiveLowYieldRounds: 2,
      nextAllowedAt: NOW + firstWait + 4 * 60 * 60 * 1_000,
    });

    round.close();
  });

  it('resets the wait when the round gains an effective candidate', async () => {
    const round = open({
      searchItems: [
        [],
        // A dated, valuable document qualifies for both pools, so both pairs
        // gain a candidate and neither keeps a wait.
        [{ source: 'zhihu', url: 'https://example.com/a', text: MATERIAL, publishedAt: NOW - 1_000 }],
      ],
    });

    expect(await round.run()).toBe('searched');
    expect(round.backoffFor('daily')?.consecutiveLowYieldRounds).toBe(1);

    // The second search adds a candidate, so both pools start over at n = 0.
    round.advance(2 * 60 * 60 * 1_000);
    expect(await round.run()).toBe('searched');
    expect(round.backoff()).toEqual([]);

    round.close();
  });

  it('keeps a failed and a skipped search out of the low-yield count', async () => {
    const round = open({ failure: { code: 'rate_limited', message: '频率限制', retryable: true } });

    expect(await round.run()).toBe('failed');
    expect(round.backoff()).toEqual([]);
    expect(round.searchOutcomes()).toEqual(['failed']);

    // The throttled source is still cooling down, so this round runs no search
    // at all: neither a failure nor a skip is a low-yield round.
    round.advance(1_000);
    expect(await round.run()).toBe('skipped');
    expect(round.backoff()).toEqual([]);
    expect(round.searchOutcomes()).toEqual(['failed']);

    round.close();
  });

  it('never waits longer than maxSearchBackoffHours', async () => {
    // Ten hours × 2^n passes the 24 hour ceiling from the third round on.
    const round = open({ maxSearchBackoffHours: 24, maintenanceIntervalMinutes: 600 });

    expect(await round.run()).toBe('searched');
    round.advanceTo(NOW + 20 * HOUR);
    expect(await round.run()).toBe('searched');
    round.advanceTo(NOW + 44 * HOUR);
    expect(await round.run()).toBe('searched');

    const capped = round.backoffFor('daily');
    expect(capped?.consecutiveLowYieldRounds).toBe(3);
    expect(capped?.nextAllowedAt).toBe(NOW + 44 * HOUR + 24 * HOUR);

    round.close();
  });

  it('reports the backoff without asking the planner and without hiding the gap', async () => {
    const round = open();

    expect(await round.run()).toBe('searched');
    expect(round.planningCalls()).toBe(1);
    round.advance(1_000);

    expect(await round.run()).toBe('held_back');
    // The gap was never handed to the planner, so the round spent no call on it.
    expect(round.planningCalls()).toBe(1);
    expect(round.issues()).toContainEqual({
      stage: 'search',
      code: 'SEARCH_BACKOFF',
      subjectId: INTEREST_ID,
      message: expect.stringContaining('daily'),
    });
    // Slower searches never relax a threshold: the pool is still below its
    // minimum and the round still reports that.
    expect(round.dailyMinimumDeficit()).toBeGreaterThan(0);
    expect(round.stopReason()).toBe('sources_exhausted');

    round.close();
  });

  it('starts over at n = 0 after the interest description changed', async () => {
    const round = open();

    expect(await round.run()).toBe('searched');
    expect(round.backoffFor('daily')?.consecutiveLowYieldRounds).toBe(1);

    round.setInterestText('Rust 异步运行时与调度器');
    round.advance(1_000);
    expect(await round.run()).toBe('searched');
    expect(round.backoffFor('daily')).toEqual({
      interestId: INTEREST_ID,
      interestText: 'Rust 异步运行时与调度器',
      pool: 'daily',
      consecutiveLowYieldRounds: 1,
      nextAllowedAt: NOW + 1_000 + 2 * 60 * 60 * 1_000,
    });

    round.close();
  });

  it('drops the record of an interest that is disabled and starts over when it returns', async () => {
    const round = open();

    expect(await round.run()).toBe('searched');
    expect(round.backoffFor('daily')).toBeDefined();

    round.setEnabled(false);
    round.advance(1_000);
    // A disabled interest takes no part in a round, so no record is written.
    expect(await round.run()).toBe('held_back');
    expect(round.backoff()).toEqual([]);

    round.setEnabled(true);
    expect(await round.run()).toBe('searched');
    expect(round.backoffFor('daily')?.consecutiveLowYieldRounds).toBe(1);

    round.close();
  });

  it('reads and writes one backoff record per interest and pool', () => {
    const database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
    const search = createSearchStorage(database);

    expect(search.readSearchBackoff()).toEqual([]);
    search.writeSearchBackoff([
      record({ interestId: 'i1', pool: 'daily', consecutiveLowYieldRounds: 2, nextAllowedAt: 500 }),
      record({ interestId: 'i2', pool: 'daily', consecutiveLowYieldRounds: 1, nextAllowedAt: 400 }),
      record({ interestId: 'i1', pool: 'long_term', consecutiveLowYieldRounds: 1, nextAllowedAt: 300 }),
    ]);

    expect(search.readSearchBackoff()).toEqual([
      record({ interestId: 'i1', pool: 'daily', consecutiveLowYieldRounds: 2, nextAllowedAt: 500 }),
      record({ interestId: 'i1', pool: 'long_term', consecutiveLowYieldRounds: 1, nextAllowedAt: 300 }),
      record({ interestId: 'i2', pool: 'daily', consecutiveLowYieldRounds: 1, nextAllowedAt: 400 }),
    ]);

    // Clearing the state leaves a readable empty value behind.
    search.writeSearchBackoff([]);
    expect(search.readSearchBackoff()).toEqual([]);
    expect(backoffColumn(database)).toBe('[]');

    database.close();
  });

  /** Composes supply over one in-memory Database with a stubbed model and source. */
  function open(
    input: {
      readonly searchItems?: readonly (readonly {
        source: string;
        url: string;
        text: string;
        publishedAt: number;
      }[])[];
      readonly failure?: { code: string; message: string; retryable: boolean };
      readonly maintenanceIntervalMinutes?: number;
      readonly maxSearchBackoffHours?: number;
    } = {},
  ) {
    const database: DatabaseConnection = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
    const interests = createInterestManagement({
      storage: createInterestStorage(database),
      newInterestId: () => INTEREST_ID,
      now: () => NOW,
    });
    void interests.createInterest({ text: INTEREST_TEXT });
    const contents = createContentStorage(database);
    const candidates = createCandidateStorage(database);
    const search = createSearchStorage(database);
    const usage = {
      async readUsageSnapshot() {
        return { revision: 'rev-1', excludedContentIds: [] as string[] };
      },
    };
    const config: SupplyExecutionConfig = {
      daily: configuration.daily,
      longTerm: configuration.longTerm,
      freshnessDays: configuration.freshnessDays,
      maintenanceIntervalMinutes:
        input.maintenanceIntervalMinutes ?? configuration.maintenanceIntervalMinutes,
      contentLanguages: configuration.contentLanguages,
      searchHistoryDays: configuration.searchHistoryDays,
      searchReuseIntervalMinutes: configuration.searchReuseIntervalMinutes,
      limits: configuration.limits,
      maxSearchBackoffHours: input.maxSearchBackoffHours ?? configuration.maxSearchBackoffHours,
    };

    let clock = NOW;
    let searchIndex = 0;
    let sequence = 0;
    let planningCalls = 0;
    let sourceCalls = 0;
    let lastResult: {
      readonly stopReason: string;
      readonly poolHealth: readonly { readonly pool: string; readonly minimumDeficit: number }[];
      readonly issues: readonly { readonly stage: string; readonly code: string }[];
    };
    const client = {
      async completeSimple(_model: Model<Api>, context: Context) {
        const system = context.systemPrompt ?? '';
        if (system.includes('You decide whether each listed source item')) {
          const prompt = String(context.messages[0]?.content ?? '');
          return fauxAssistantMessage(
            JSON.stringify({
              decisions: listedItemIds(prompt).map((itemId) => ({ itemId, verdict: 'keep' })),
            }),
          );
        }
        if (system.includes('You analyze exactly one source document')) {
          return fauxAssistantMessage(
            JSON.stringify({
              summary: 'Tokio 运行时简介',
              keyPoints: [
                { text: '提供异步调度', evidence: 'Tokio 运行时提供异步任务调度与超时控制' },
              ],
              topics: ['异步'],
              entities: ['Tokio'],
              contentType: 'article',
              qualityScore: 0.6,
              spamScore: 0.1,
              longTermValue: 'learning',
              matches: [{ interestId: INTEREST_ID, relation: 'direct', basis: '直接讨论 Tokio' }],
            }),
          );
        }
        if (system.includes('You judge how each listed interest')) {
          return fauxAssistantMessage(JSON.stringify({ matches: [] }));
        }
        if (system.includes('You plan searches')) {
          planningCalls += 1;
          // Every round searches a fresh expression: the same query and window
          // inside the reuse interval is a repeated visit, not a new search.
          return fauxAssistantMessage(
            JSON.stringify({
              items: [
                {
                  interestId: INTEREST_ID,
                  pools: ['daily', 'long_term'],
                  source: 'zhihu',
                  priority: 1,
                  query: `${INTEREST_TEXT} #${planningCalls}`,
                },
              ],
            }),
          );
        }
        throw new Error(`unexpected model task: ${system.slice(0, 60)}`);
      },
    };
    const source: SourceConnector = {
      id: 'zhihu',
      descriptor: stubDescriptor,
      async search() {
        sourceCalls += 1;
        if (input.failure) return { status: 'failed', failure: input.failure };
        const items = input.searchItems?.[searchIndex] ?? [];
        searchIndex += 1;
        return { status: 'success', items: [...items] };
      },
      async fetch() {
        return {
          status: 'failed',
          failure: { code: 'material_unavailable', message: 'not used', retryable: false },
        };
      },
    };
    const model = resolveModel();
    const supply = createCandidateSupply({
      local: { database, contents, candidates, usage, interests, now: () => clock },
      readConfig: async () => ({ status: 'ok', config }),
      openRound: async () => ({
        status: 'ok',
        model,
        dependencies: {
          config,
          database,
          model,
          sources: [source],
          client,
          interests,
          contents,
          candidates,
          search,
          usage,
          retention: { findRetainedContentIds: async () => [] },
          newId: (prefix: string) => `${prefix}-${(sequence += 1)}`,
          now: () => clock,
        },
      }),
      newId: (prefix) => `${prefix}-${(sequence += 1)}`,
    });

    return {
      /** Runs one round and says what happened to the search it would have run. */
      async run(): Promise<'searched' | 'failed' | 'skipped' | 'held_back'> {
        const historyBefore = search.listRecentSearches({ since: 0 }).length;
        const sourceCallsBefore = sourceCalls;
        const plannedBefore = planningCalls;
        const handle = supply.startMaintenance({ reason: 'periodic' });
        lastResult = await handle.result;
        const history = search.listRecentSearches({ since: 0 });
        if (history.length > historyBefore) {
          return history[0]?.outcome === 'success' ? 'searched' : 'failed';
        }
        if (sourceCalls > sourceCallsBefore) return 'failed';
        // A round that never reached the planner was held back before it could
        // spend a call; one that planned but ran nothing was skipped instead.
        return planningCalls === plannedBefore ? 'held_back' : 'skipped';
      },
      backoff: () => search.readSearchBackoff(),
      backoffFor: (pool: CandidatePool) =>
        search.readSearchBackoff().find((record) => record.pool === pool),
      searchOutcomes: () =>
        search
          .listRecentSearches({ since: 0 })
          .map((record) => record.outcome)
          .reverse(),
      planningCalls: () => planningCalls,
      issues: () => lastResult.issues,
      stopReason: () => lastResult.stopReason,
      dailyMinimumDeficit: () =>
        lastResult.poolHealth.find((health) => health.pool === 'daily')?.minimumDeficit,
      advance: (milliseconds: number) => {
        clock += milliseconds;
      },
      advanceTo: (at: number) => {
        clock = at;
      },
      setInterestText: (text: string) => {
        void interests.updateInterest({ id: INTEREST_ID, text });
      },
      setEnabled: (enabled: boolean) => {
        void interests.updateInterest({ id: INTEREST_ID, enabled });
      },
      close: () => {
        void supply.close();
        database.close();
      },
    };
  }
});

/** The item ids a screening prompt listed, so every discovery gets a verdict. */
function listedItemIds(prompt: string): string[] {
  return [...prompt.matchAll(/"itemId":"([^"]+)"/gu)].map((match) => match[1] ?? '');
}

/** One saved backoff record with the fields a test does not vary. */
function record(
  input: {
    readonly interestId: string;
    readonly pool: CandidatePool;
    readonly consecutiveLowYieldRounds: number;
    readonly nextAllowedAt: number;
  },
): SearchBackoffRecord {
  return { ...input, interestText: `interest ${input.interestId}` };
}

/** A registered model, so the round reads a real context window and token ceiling. */
function resolveModel(): Model<Api> {
  const models = createModels();
  models.setProvider(fauxProvider({ models: [{ id: 'faux-supply' }] }).provider);
  const model = models.getModel('faux', 'faux-supply');
  if (!model) throw new Error('expected the faux model to be registered');
  return model;
}

function backoffColumn(database: DatabaseConnection): string | undefined {
  return database
    .prepare<{ search_backoff: string }>({
      sql: 'SELECT search_backoff FROM candidate_supply_state WHERE id = 1',
    })
    .get()?.search_backoff;
}
