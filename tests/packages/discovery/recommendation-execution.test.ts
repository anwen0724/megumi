/* Verifies Recommendation freezes all eligible facts before delegating one execution to Agent Core. */
// @vitest-environment node
import type { Api, Model } from '@megumi/ai';
import { createDatabase, migrateDatabase, type DatabaseConnection } from '@megumi/database';
import {
  createDiscoveryRepository,
  createRecommendationAttempts,
  createRecommendationRuntime,
  createSourceRegistry,
  type CreateRecommendationRuntimeOptions,
  type DiscoverySource,
} from '@megumi/discovery';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const now = '2026-09-03T00:00:00.000Z';

describe('Recommendation runtime', () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
    seedInterest(database);
  });

  afterEach(() => database.close());

  it('returns waiting without starting Agent Core when no Candidate is eligible', async () => {
    const startExecution = vi.fn();
    const runtime = createRecommendationRuntime(runtimeOptions(database, startExecution));

    await expect(runtime.request({ trigger: 'manual' })).resolves.toEqual({
      status: 'waiting_for_candidates', localDate: '2026-09-03',
    });
    expect(startExecution).not.toHaveBeenCalled();
  });

  it('joins concurrent requests while model resolution is still starting one execution', async () => {
    seedCandidate(database, 1);
    let releaseModel!: () => void;
    const modelReady = new Promise<void>((resolve) => { releaseModel = resolve; });
    const startExecution: CreateRecommendationRuntimeOptions['startExecution'] = vi.fn(async (request) => {
      const executionId = 'execution:1';
      const accepted = await request.accept({ executionId });
      if (accepted.status === 'rejected') return { status: 'rejected', reason: accepted.reason };
      return {
        status: 'started',
        execution: { kind: 'recommendation', executionId },
        completion: new Promise<never>(() => undefined),
      };
    });
    const runtime = createRecommendationRuntime({
      ...runtimeOptions(database, startExecution),
      resolveModel: async () => {
        await modelReady;
        return { status: 'ok', model };
      },
    });

    const first = runtime.request({ trigger: 'manual' });
    const second = runtime.request({ trigger: 'manual' });
    releaseModel();

    await expect(first).resolves.toMatchObject({
      status: 'started', requestId: 'request:1', executionId: 'execution:1',
    });
    await expect(second).resolves.toMatchObject({
      status: 'in_progress', requestId: 'request:1', executionId: 'execution:1',
    });
    expect(startExecution).toHaveBeenCalledTimes(1);
    await runtime.shutdown();
  });

  it('publishes the configured target through Agent Core and exposes all ranked facts to the attempt', async () => {
    for (let index = 1; index <= 3; index += 1) seedCandidate(database, index);
    const attempts = createRecommendationAttempts();
    const startExecution: CreateRecommendationRuntimeOptions['startExecution'] = vi.fn(async (request) => {
      const executionId = 'execution:1';
      const accepted = await request.accept({ executionId });
      if (accepted.status === 'rejected') return { status: 'rejected', reason: accepted.reason };
      const completion = Promise.resolve({ status: 'completed' as const });
      setTimeout(() => {
        void attempts.publishRecommendations({
          executionId,
          signal: new AbortController().signal,
          input: {
            items: [
              { candidateId: 'candidate:1', recommendationReason: 'Reason one.' },
              { candidateId: 'candidate:2', recommendationReason: 'Reason two.' },
            ],
          },
        }).then(() => request.onSettled({ executionId, outcome: { status: 'completed' } }));
      }, 0);
      return {
        status: 'started',
        execution: { kind: 'recommendation', executionId },
        completion,
      };
    });
    const runtime = createRecommendationRuntime(runtimeOptions(database, startExecution, attempts));

    const accepted = await runtime.request({ trigger: 'manual' });
    expect(accepted).toMatchObject({
      status: 'started', localDate: '2026-09-03', requestId: 'request:1', executionId: 'execution:1',
    });
    const snapshot = attempts.getSnapshot('execution:1');
    expect(snapshot).toMatchObject({ actualTarget: 2, workingSetCount: 2 });
    expect(snapshot?.rankedCandidates).toHaveLength(3);

    await expect(runtime.wait({ requestId: 'request:1', timeoutMs: 1_000 })).resolves.toMatchObject({
      status: 'published',
      collection: { localDate: '2026-09-03', items: [{ candidateId: 'candidate:1' }, { candidateId: 'candidate:2' }] },
    });
  });

  it('keeps one request identity while retrying a retryable Agent execution with a new snapshot', async () => {
    for (let index = 1; index <= 2; index += 1) seedCandidate(database, index);
    const attempts = createRecommendationAttempts();
    const scheduled: Array<{ delayMs: number; callback: () => void }> = [];
    let executionNumber = 0;
    const startExecution: CreateRecommendationRuntimeOptions['startExecution'] = vi.fn(async (request) => {
      const executionId = `execution:${++executionNumber}`;
      const accepted = await request.accept({ executionId });
      if (accepted.status === 'rejected') return { status: 'rejected', reason: accepted.reason };
      if (executionNumber === 1) {
        queueMicrotask(() => void request.onSettled({
          executionId,
          outcome: {
            status: 'failed',
            failure: { code: 'provider_unavailable', message: 'Temporary provider failure.', retryable: true },
          },
        }));
      } else {
        queueMicrotask(() => {
          void attempts.publishRecommendations({
            executionId,
            signal: new AbortController().signal,
            input: {
              items: [
                { candidateId: 'candidate:1', recommendationReason: 'Reason one.' },
                { candidateId: 'candidate:2', recommendationReason: 'Reason two.' },
              ],
            },
          }).then(() => request.onSettled({ executionId, outcome: { status: 'completed' } }));
        });
      }
      return {
        status: 'started',
        execution: { kind: 'recommendation', executionId },
        completion: Promise.resolve({ status: 'completed' }),
      };
    });
    const options: CreateRecommendationRuntimeOptions = {
      ...runtimeOptions(database, startExecution, attempts),
      timers: {
      setTimeout(callback, delayMs) {
        scheduled.push({ callback, delayMs });
        return callback;
      },
      clearTimeout() {},
      },
    };
    const runtime = createRecommendationRuntime(options);

    const accepted = await runtime.request({ trigger: 'manual' });
    expect(accepted).toMatchObject({ status: 'started', requestId: 'request:1', executionId: 'execution:1' });
    await vi.waitFor(() => expect(scheduled).toHaveLength(1));
    expect(scheduled[0]?.delayMs).toBe(5_000);
    scheduled[0]?.callback();

    await expect(runtime.wait({ requestId: 'request:1', timeoutMs: 1_000 })).resolves.toMatchObject({
      status: 'published',
      collection: { items: [{ candidateId: 'candidate:1' }, { candidateId: 'candidate:2' }] },
    });
    expect(startExecution).toHaveBeenCalledTimes(2);
    expect(attempts.getSnapshot('execution:1')).toBeUndefined();
    expect(attempts.getSnapshot('execution:2')).toBeUndefined();
  });
});

function runtimeOptions(
  database: DatabaseConnection,
  startExecution: CreateRecommendationRuntimeOptions['startExecution'],
  attempts = createRecommendationAttempts(),
): CreateRecommendationRuntimeOptions {
  let requestId = 0;
  return {
    repository: createDiscoveryRepository({
      database,
      clock: { now: () => now },
      candidateIds: {
        createCandidateId: () => 'unused',
        createInterestMatchId: () => 'unused',
      },
    }),
    attempts,
    sourceRegistry: createSourceRegistry([source()]),
    startExecution,
    resolveModel: async () => ({ status: 'ok', model }),
    settings: {
      resolve: () => ({
        recommendationGenerationTime: '08:00',
        recommendationTargetCount: 2,
        recommendationWorkingSetCount: 2,
        candidatePoolMinimumCount: 1,
        candidatePoolMaximumCount: 200,
        candidateValidityDays: 30,
        candidateContentExcerptMaxCharacters: 8_000,
      }),
    },
    clock: { now: () => now },
    timezone: { get: () => 'UTC' },
    ids: { createRequestId: () => `request:${++requestId}` },
  };
}

function seedInterest(database: DatabaseConnection): void {
  database.prepare({ sql: `
    INSERT INTO discovery_interests (
      interest_id, revision, description, status, created_from, user_managed_at, created_at, updated_at
    ) VALUES ('interest:1', 1, 'Agent architecture', 'active', 'manual', ?, ?, ?)
  ` }).run([now, now, now]);
}

function seedCandidate(database: DatabaseConnection, index: number): void {
  database.prepare({ sql: `
    INSERT INTO discovery_candidates (
      id, content_identity, source_id, canonical_url, content_type, title,
      content_summary, content_truncated, status, created_at, expires_at
    ) VALUES (?, ?, 'source:1', ?, 'article', ?, ?, 0, 'available', ?, ?)
  ` }).run([
    `candidate:${index}`, `identity:${index}`, `https://example.com/${index}`,
    `Candidate ${index}`, `Summary ${index}`, now, '2026-09-04T00:00:00.000Z',
  ]);
  database.prepare({ sql: `
    INSERT INTO discovery_candidate_interest_matches (
      id, candidate_id, interest_id, relevance, match_reason
    ) VALUES (?, ?, 'interest:1', 'direct', 'Direct match.')
  ` }).run([`match:${index}`, `candidate:${index}`]);
}

function source(): DiscoverySource {
  return {
    descriptor: {
      id: 'source:1', name: 'Source One', access: 'public_http',
      supportedModes: ['relevance'], supportsRead: false,
    },
    getAvailability: () => ({ state: 'ready' }),
    search: async () => ({ status: 'success', items: [] }),
  };
}

const model = {
  id: 'model:1', name: 'Model', api: 'openai-completions', provider: 'openai',
  baseUrl: 'https://example.com', reasoning: false, input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000, maxTokens: 4_096,
} as Model<Api>;
