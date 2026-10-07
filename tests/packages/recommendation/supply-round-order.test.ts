/*
 * Verifies the order and the outcome of one maintenance round: saved analysis is
 * reused before any search budget is spent, and content that is only waiting for
 * a pool relation becomes a candidate instead of staying invisible.
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { stubDescriptor } from './source-fixture';
import { fauxAssistantMessage, type Api, type Context, type Model } from '@megumi/ai';
import type { TextModelClient } from '@megumi/application/recommendation/call-text-model';
import { createCandidateStorage } from '@megumi/application/recommendation/candidates/candidate-storage';
import { createContentStorage } from '@megumi/application/recommendation/content/content-storage';
import { createSearchStorage } from '@megumi/application/recommendation/discovery/search-storage';
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

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1_000;
const MATERIAL = 'Tokio 运行时提供异步任务调度与超时控制，这段文本用于关键点证据比对。';

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

describe('one maintenance round', () => {
  it('reuses saved analysis before spending search budget and then qualifies it', async () => {
    const round = open({ judged: false });

    const result = await round.supply.prepareCandidates({
      requirement: { pool: 'daily', minimumCount: 1, coverage: [{ interestId: 'i1', minimumCount: 1 }] },
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('expected a ready snapshot');
    expect(result.snapshot.counts.total).toBe(1);
    // The saved analysis closed the gap, so planning and searching never ran.
    expect(round.planCalls).toBe(0);
    expect(round.sourceSearchCalls).toBe(0);
    round.close();
  });

  it('qualifies content that already has a judgement but never got a pool relation', async () => {
    const round = open({ judged: true });

    const result = await round.supply.prepareCandidates({
      requirement: { pool: 'daily', minimumCount: 1, coverage: [{ interestId: 'i1', minimumCount: 1 }] },
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('expected a ready snapshot');
    expect(result.snapshot.counts.total).toBe(1);
    // Nothing had to be judged or planned: only the missing pool relation was committed.
    expect(round.modelCalls).toBe(0);
    expect(round.sourceSearchCalls).toBe(0);
    round.close();
  });

  /** Composes supply over one isolated Database with a counting model and source. */
  function open(input: { readonly judged: boolean }) {
    const database: DatabaseConnection = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
    database
      .prepare({
        sql: "INSERT INTO interests (id, text, enabled, created_at, updated_at) VALUES ('i1','Rust 异步运行时',1,0,0)",
      })
      .run();
    database
      .prepare({
        sql: `INSERT INTO contents (id, source, canonical_url, text, published_at, created_at, updated_at)
              VALUES ('c1','zhihu','https://example.com/1',?,?,0,0)`,
      })
      .run([MATERIAL, NOW - DAY]);
    database
      .prepare({
        sql: `INSERT INTO content_analysis
                (content_id, summary, key_points, topics, entities, content_type, quality_score,
                 spam_score, long_term_value, status, attempts, analyzed_at)
              VALUES ('c1','Tokio 运行时简介','[{"text":"提供异步调度","evidence":"Tokio 运行时提供异步任务调度与超时控制"}]',
                      '["异步"]','["Tokio"]','article',0.6,0.1,'learning','ready',1,0)`,
      })
      .run();
    if (input.judged) {
      database
        .prepare({
          sql: `INSERT INTO content_interest_matches (content_id, interest_id, relation, basis, matched_at)
                VALUES ('c1','i1','direct','直接讨论 Tokio',0)`,
        })
        .run();
    }

    const interests = createInterestManagement({
      storage: createInterestStorage(database),
      newInterestId: () => 'generated',
      now: () => NOW,
    });
    const contents = createContentStorage(database);
    const candidates = createCandidateStorage(database);
    const usage = {
      async readUsageSnapshot() {
        return { revision: 'rev-1', excludedContentIds: [] as string[] };
      },
    };
    const counters = { modelCalls: 0, planCalls: 0, sourceSearchCalls: 0 };
    const client: TextModelClient = {
      async completeSimple(_model: Model<Api>, context: Context) {
        counters.modelCalls += 1;
        const system = context.systemPrompt ?? '';
        if (system.includes('You judge how each listed interest')) {
          return fauxAssistantMessage(
            JSON.stringify({
              matches: [
                { contentId: 'c1', interestId: 'i1', relation: 'direct', basis: '直接讨论 Tokio' },
              ],
            }),
          );
        }
        if (system.includes('You plan searches')) {
          counters.planCalls += 1;
          return fauxAssistantMessage(JSON.stringify({ items: [] }));
        }
        throw new Error(`unexpected model task: ${system.slice(0, 60)}`);
      },
    };
    const source: SourceConnector = {
      id: 'zhihu',
      descriptor: stubDescriptor,
      id: 'zhihu',
      async search() {
        counters.sourceSearchCalls += 1;
        return { status: 'success', items: [] };
      },
      async fetch() {
        return {
          status: 'failed',
          failure: { code: 'material_unavailable', message: 'not used', retryable: false },
        };
      },
    };
    const model = { id: 'faux-supply' } as Model<Api>;
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
          sources: [source],
          client,
          interests,
          contents,
          candidates,
          search: createSearchStorage(database),
          usage,
          retention: { findRetainedContentIds: async () => [] },
          newId: (prefix: string) => `${prefix}-1`,
          now: () => NOW,
        },
      }),
      newId: (prefix) => `${prefix}-1`,
    });

    return {
      supply,
      get modelCalls() {
        return counters.modelCalls;
      },
      get planCalls() {
        return counters.planCalls;
      },
      get sourceSearchCalls() {
        return counters.sourceSearchCalls;
      },
      close: () => {
        void supply.close();
        database.close();
      },
    };
  }
});
