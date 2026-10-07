/*
 * Verifies how one running maintenance round treats the callers waiting on it.
 * Two preparation requests share the round instead of starting a second one,
 * cancelling one caller settles only that caller, and closing ends every wait
 * while writing nothing after it resolved.
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
import {
  SupplyLifecycleError,
  type CandidateRequirement,
  type CandidateSupply,
  type UsageReader,
} from '@megumi/application/recommendation/supply/supply-contracts';
import { CandidateSupplyConfigurationSchema } from '@megumi/application/settings/definitions/discovery';
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
import { stubDescriptor } from './source-fixture';

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1_000;
const MATERIAL = 'Tokio 运行时提供异步任务调度与超时控制，这段文本用于关键点证据比对。';

// The daily pool starts short, so a preparation request opens a round that has
// to plan and search; the long-term pool has no minimum at all.
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

describe('callers sharing one maintenance round', () => {
  let held: HeldSupply;

  beforeEach(() => {
    held = holdSupply();
  });

  afterEach(async () => {
    await held.finish();
  });

  it('shares one round between two preparation callers and cancels only the caller that aborted', async () => {
    const requirement: CandidateRequirement = { pool: 'daily', minimumCount: 1, coverage: [] };
    const cancelled = new AbortController();

    const cancelledCaller = held.supply.prepareCandidates({
      requirement,
      signal: cancelled.signal,
    });
    // The round is now held inside the source call, so both callers provably
    // join the round that is already running.
    await held.searchStarted;
    const otherCaller = held.supply.prepareCandidates({ requirement });

    cancelled.abort();
    await expect(cancelledCaller).resolves.toEqual({ status: 'cancelled' });

    held.releaseSearch();
    const delivered = await otherCaller;

    expect(delivered.status).toBe('ready');
    if (delivered.status !== 'ready') throw new Error('expected a ready snapshot');
    expect(delivered.snapshot.counts.total).toBe(1);
    // One round and one source call: the second caller joined the running round
    // instead of starting its own.
    expect(held.openRoundCalls).toBe(1);
    expect(held.sourceSearchCalls).toBe(1);
  });

  it('ends a waiting caller when the service closes and writes nothing after close resolved', async () => {
    const requirement: CandidateRequirement = { pool: 'daily', minimumCount: 1, coverage: [] };

    const waiting = held.supply.prepareCandidates({ requirement });
    await held.searchStarted;

    const closing = held.supply.close();
    // A repeated close waits for the same closing process instead of returning
    // early while the round is still finishing.
    let repeatedSettled = false;
    const repeated = held.supply.close().then(() => {
      repeatedSettled = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(repeatedSettled).toBe(false);
    const planningWhenClosed = held.planningCalls;

    held.releaseSearch();
    await closing;
    await repeated;
    expect(repeatedSettled).toBe(true);

    // Closing ends every wait: the caller must learn its wait was cancelled
    // rather than be told the round produced too few candidates.
    await expect(waiting).resolves.toEqual({ status: 'cancelled' });
    // A cancelled round starts no further model request.
    expect(held.planningCalls).toBe(planningWhenClosed);

    const writesWhenClosed = held.writes.length;
    // Guard the tracker itself: the round that just finished did write.
    expect(writesWhenClosed).toBeGreaterThan(0);

    // A second close repeats no cleanup and writes nothing.
    await held.supply.close();
    expect(held.writes.length).toBe(writesWhenClosed);

    // Closed means closed: no new wait is accepted and no work is started.
    await expect(held.supply.prepareCandidates({ requirement })).resolves.toMatchObject({
      status: 'unavailable',
      code: 'SERVICE_CLOSED',
    });
    expect(() => held.supply.startMaintenance({ reason: 'periodic' })).toThrow(SupplyLifecycleError);
    expect(held.writes.length).toBe(writesWhenClosed);
  });
});

interface HeldSupply {
  readonly supply: CandidateSupply;
  /** Resolves when the round reached the source call the test controls. */
  readonly searchStarted: Promise<void>;
  /** Statements the round actually wrote, in order. */
  readonly writes: readonly string[];
  readonly openRoundCalls: number;
  readonly sourceSearchCalls: number;
  readonly planningCalls: number;
  releaseSearch(): void;
  /** Releases the held search, closes the service, and closes the database. */
  finish(): Promise<void>;
}

/**
 * Composes the real supply over one in-memory Database. The source hands the
 * test a promise it settles itself, so the round stays open exactly as long as
 * the test needs and no ordering depends on timing.
 */
function holdSupply(): HeldSupply {
  const connection = createDatabase({ filename: ':memory:' });
  migrateDatabase({ database: connection });
  const writes = trackWrites(connection);
  const database = writes.database;

  database
    .prepare({
      sql: "INSERT INTO interests (id, text, enabled, created_at, updated_at) VALUES ('i1','Rust 异步运行时',1,0,0)",
    })
    .run();

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

  const searchStarted = createDeferred();
  const searchGate = createDeferred();
  const counters = { openRoundCalls: 0, sourceSearchCalls: 0, planningCalls: 0 };

  const client: TextModelClient = {
    async completeSimple(_model, context) {
      const systemPrompt = context.systemPrompt ?? '';
      if (systemPrompt.includes('You plan searches')) {
        counters.planningCalls += 1;
        return fauxAssistantMessage(
          JSON.stringify({
            items: [
              {
                interestId: 'i1',
                pools: ['daily'],
                source: 'zhihu',
                priority: 1,
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
      throw new Error(`unexpected model task: ${systemPrompt.slice(0, 40)}`);
    },
  };

  const source: SourceConnector = {

    id: 'zhihu',

    descriptor: stubDescriptor,
    id: 'zhihu',
    async search() {
      counters.sourceSearchCalls += 1;
      searchStarted.resolve();
      await searchGate.promise;
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

  let sequence = 0;
  const newId = (prefix: string) => `${prefix}-${++sequence}`;

  const supply = createCandidateSupply({
    local: { database, contents, candidates, usage, interests, now: () => NOW },
    readConfig: async () => ({ status: 'ok', config }),
    openRound: async () => {
      counters.openRoundCalls += 1;
      return {
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
          newId,
          now: () => NOW,
        },
      };
    },
    newId,
  });

  return {
    supply,
    searchStarted: searchStarted.promise,
    get writes() {
      return writes.statements;
    },
    get openRoundCalls() {
      return counters.openRoundCalls;
    },
    get sourceSearchCalls() {
      return counters.sourceSearchCalls;
    },
    get planningCalls() {
      return counters.planningCalls;
    },
    releaseSearch: () => searchGate.resolve(),
    finish: async () => {
      searchGate.resolve();
      await supply.close();
      connection.close();
    },
  };
}

interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
}

/** A promise the test settles itself; resolving twice is harmless. */
function createDeferred(): Deferred {
  const state: { settle?: () => void } = {};
  const promise = new Promise<void>((resolve) => {
    state.settle = resolve;
  });
  return {
    promise,
    resolve: () => {
      state.settle?.();
    },
  };
}

/**
 * Wraps one real connection so the test can see which statements a round wrote.
 * Every statement still runs on the real connection; only the record is added.
 */
function trackWrites(connection: DatabaseConnection): {
  readonly database: DatabaseConnection;
  readonly statements: string[];
} {
  const statements: string[] = [];
  const writePattern = /^\s*(?:insert|update|delete)\b/iu;
  return {
    statements,
    database: {
      prepare<TRow extends DatabaseRow>(
        request: PrepareDatabaseStatementRequest,
      ): DatabaseStatement<TRow> {
        const statement = connection.prepare<TRow>(request);
        const writing = writePattern.test(request.sql);
        return {
          run(parameters) {
            const result = statement.run(parameters);
            if (writing) statements.push(request.sql);
            return result;
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
