/* Verifies Daily Recommendation starts only from a fixed Pool snapshot and publishes the dynamic target. */
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api, Model } from '@megumi/ai';
import { createDatabase, migrateDatabase, type DatabaseConnection } from '@megumi/database';
import {
  createDailyRecommendationAttempts,
  createDailyRecommendationRepository,
  createDailyRecommendationRuntime,
  createDiscoveryRepository,
  type CreateDailyRecommendationRuntimeOptions,
  type DiscoveryRepository,
} from '@megumi/discovery';

const now = '2026-08-27T08:00:00.000Z';
const model: Model<Api> = {
  id: 'model:1', name: 'Model', api: 'test-api', provider: 'test-provider',
  baseUrl: 'https://example.invalid', reasoning: false, input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8_192, maxTokens: 1_024,
};

describe('DailyRecommendationRuntime', () => {
  let database: DatabaseConnection;
  let discovery: DiscoveryRepository;

  beforeEach(() => {
    database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
    discovery = createDiscoveryRepository({ database });
  });

  afterEach(() => database.close());

  it('does not create a Batch or start a model execution when no Candidate is available', async () => {
    const repository = createDailyRecommendationRepository(database);
    const startExecution = vi.fn();
    const notifyCandidateSupply = vi.fn();
    const runtime = createDailyRecommendationRuntime(runtimeOptions(
      repository,
      { startExecution, notifyCandidateSupply },
    ));

    const result = await runtime.ensure({ trigger: 'manual', now });

    expect(result).toEqual({
      status: 'waiting_for_candidates', localDate: '2026-08-27', requestedCount: 5,
    });
    expect(repository.getBatch('2026-08-27')).toBeUndefined();
    expect(startExecution).not.toHaveBeenCalled();
    expect(notifyCandidateSupply).toHaveBeenCalledWith(5);
    expect(runtime.getHome({ mode: 'timeline', limit: 20 }).today).toEqual({
      localDate: '2026-08-27', status: 'waiting_for_candidates', resultCount: 0,
    });
    await runtime.shutdown();
  });

  it('fixes requestedCount from settings and publishes every available Candidate when A is below D', async () => {
    discovery.changeInterest({
      action: 'create', interestId: 'interest:1', description: 'Agent architecture', now,
    });
    const candidateIds = [
      admitCandidate(discovery, 'First guide'),
      admitCandidate(discovery, 'Second guide'),
    ];
    const repository = createDailyRecommendationRepository(database);
    const attempts = createDailyRecommendationAttempts();
    const startExecution = vi.fn(async (request: Parameters<CreateDailyRecommendationRuntimeOptions['startExecution']>[0]) => {
      const executionId = 'execution:daily';
      const accepted = await request.accept({ executionId });
      if (accepted.status === 'rejected') return { status: 'rejected' as const, reason: accepted.reason };
      const published = await attempts.publishDailyRecommendations({
        executionId,
        input: {
          items: candidateIds.map((candidateId, index) => ({
            candidateId,
            recommendationReason: `Reason ${index + 1}.`,
          })),
        },
        signal: new AbortController().signal,
      });
      expect(published.isError).not.toBe(true);
      return {
        status: 'started' as const,
        execution: {
          kind: 'daily_recommendation' as const,
          executionId,
          requestId: request.requestId,
          batchId: request.batchId,
          localDate: request.localDate,
          model,
          createdAt: now,
          startedAt: now,
          status: 'running' as const,
        },
        completion: Promise.resolve({ status: 'completed' as const }),
      };
    });
    const runtime = createDailyRecommendationRuntime(runtimeOptions(
      repository,
      { attempts, startExecution },
    ));

    const result = await runtime.ensure({ trigger: 'manual', now });

    expect(result).toMatchObject({
      status: 'started', localDate: '2026-08-27', requestedCount: 5, actualTarget: 2,
    });
    expect(startExecution.mock.calls[0]?.[0].material).toMatchObject({
      requestedCount: 5, actualTarget: 2, availableCount: 2, readBudget: 2,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(repository.getBatch('2026-08-27')).toMatchObject({
      status: 'published', requestedCount: 5, actualTarget: 2, resultCount: 2,
    });
    await runtime.shutdown();
  });

  it('retries the same Batch twice after execution failure and publishes on the third attempt', async () => {
    discovery.changeInterest({
      action: 'create', interestId: 'interest:1', description: 'Agent architecture', now,
    });
    const candidateId = admitCandidate(discovery, 'Retry guide');
    const repository = createDailyRecommendationRepository(database);
    const attempts = createDailyRecommendationAttempts();
    let callCount = 0;
    const startExecution = vi.fn(async (request: Parameters<CreateDailyRecommendationRuntimeOptions['startExecution']>[0]) => {
      callCount += 1;
      const executionId = `execution:${callCount}`;
      const accepted = await request.accept({ executionId });
      if (accepted.status === 'rejected') return { status: 'rejected' as const, reason: accepted.reason };
      if (callCount === 3) {
        await attempts.publishDailyRecommendations({
          executionId,
          input: { items: [{ candidateId, recommendationReason: 'Useful after retry.' }] },
          signal: new AbortController().signal,
        });
      }
      return {
        status: 'started' as const,
        execution: {
          kind: 'daily_recommendation' as const,
          executionId, requestId: request.requestId, batchId: request.batchId,
          localDate: request.localDate, model, createdAt: now, startedAt: now,
          status: 'running' as const,
        },
        completion: Promise.resolve(callCount === 3
          ? { status: 'completed' as const }
          : {
              status: 'failed' as const,
              failure: {
                code: 'model_call_failed' as const,
                message: 'Temporary model failure.',
                retryable: true,
              },
            }),
      };
    });
    const runtime = createDailyRecommendationRuntime(runtimeOptions(
      repository,
      { attempts, startExecution },
    ));

    expect(await runtime.ensure({ trigger: 'manual', now })).toMatchObject({ status: 'started' });
    await waitFor(() => repository.getBatch('2026-08-27')?.status === 'published');

    expect(startExecution).toHaveBeenCalledTimes(3);
    expect(repository.getBatch('2026-08-27')).toMatchObject({
      status: 'published', attemptCount: 3, automaticRetryCount: 2, resultCount: 1,
    });
    await runtime.shutdown();
  });
});

function runtimeOptions(
  repository: CreateDailyRecommendationRuntimeOptions['repository'],
  overrides: Partial<CreateDailyRecommendationRuntimeOptions> = {},
): CreateDailyRecommendationRuntimeOptions {
  return {
    repository,
    attempts: createDailyRecommendationAttempts(),
    startExecution: vi.fn(),
    settings: {
      getDiscoverySettings: () => ({ dailyGenerationTime: '08:00', dailyTargetCount: 5 }),
    },
    timezone: () => 'UTC',
    resolveModel: async () => model,
    ids: {
      createBatchId: () => 'batch:daily',
      createRecommendationId: () => `recommendation:${crypto.randomUUID()}`,
    },
    now: () => now,
    notifyCandidateSupply: vi.fn(),
    ...overrides,
  };
}

function admitCandidate(repository: DiscoveryRepository, title: string): string {
  const suffix = title.toLowerCase().replaceAll(' ', '-');
  repository.beginQuery({
    queryId: `query:${suffix}`, executionId: 'execution:supply', sourceId: 'open_web',
    query: title, mode: 'relevance', targetInterestIds: ['interest:1'], startedAt: now,
  });
  const candidate = repository.commitSearchResult({
    queryId: `query:${suffix}`, completedAt: now, hardLimit: 100,
    items: [{
      sourceId: 'open_web', sourceName: 'example.com', sourceContentId: suffix,
      canonicalUrl: `https://example.com/${suffix}`, contentType: 'article', title,
      description: `${title} with concrete implementation detail.`,
    }],
  }).candidates[0];
  if (!candidate) throw new Error('Expected Candidate material.');
  repository.commitAdmission({
    executionId: 'execution:supply', assessmentVersion: 'candidate-admission:v1', assessedAt: now,
    decisions: [{
      candidateId: candidate.candidateId, decision: 'admit', relevance: 'direct',
      matchedInterestIds: ['interest:1'], contentValue: 'substantive', novelty: 'novel',
      temporalValidity: 'valid', negativeConstraint: 'clear', reason: `${title} is useful.`,
    }],
  });
  return candidate.candidateId;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for Daily Recommendation settlement.');
}
