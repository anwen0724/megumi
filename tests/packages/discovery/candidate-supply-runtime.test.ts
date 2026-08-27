/* Verifies Candidate Supply is gap-driven, single-flight, and scheduled only by business wake times. */
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api, Model } from '@megumi/ai';
import { createDatabase, migrateDatabase, type DatabaseConnection } from '@megumi/database';
import {
  createCandidateSupplyRuntime,
  createDiscoveryRepository,
  createSourceRegistry,
  type CandidateSupplyAttempts,
  type DiscoveryRepository,
  type DiscoverySource,
} from '@megumi/discovery';

const now = '2026-08-27T00:00:00.000Z';
const model: Model<Api> = {
  id: 'model:1', name: 'Model', api: 'test-api', provider: 'test-provider',
  baseUrl: 'https://example.invalid', reasoning: false, input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8_192, maxTokens: 1_024,
};

describe('CandidateSupplyRuntime', () => {
  let database: DatabaseConnection;
  let repository: DiscoveryRepository;

  beforeEach(() => {
    database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
    repository = createDiscoveryRepository({ database });
  });
  afterEach(() => database.close());

  it('does not resolve a model or start an execution when Pool has no gap', async () => {
    seedAvailableCandidate(repository);
    const startExecution = vi.fn();
    const resolveModel = vi.fn(async () => ({ status: 'ok' as const, model }));
    const timerSet = vi.fn(() => 'timer');
    const runtime = createCandidateSupplyRuntime(runtimeOptions({
      repository, startExecution, resolveModel,
      timers: { set: timerSet, clear: vi.fn() },
    }));

    await runtime.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(resolveModel).not.toHaveBeenCalled();
    expect(startExecution).not.toHaveBeenCalled();
    expect(timerSet).toHaveBeenCalledTimes(1);
    await runtime.shutdown();
  });

  it('starts one Candidate Supply execution from the deterministic gap snapshot', async () => {
    repository.changeInterest({
      action: 'create', interestId: 'interest:1', description: 'Agent architecture', now,
    });
    let acceptExecution: (() => void) | undefined;
    const startExecution = vi.fn(async (request: import('@megumi/execution').CandidateSupplyExecutionInput) => {
      const accepted = await request.accept({ executionId: 'execution:supply' });
      expect(accepted.status).toBe('accepted');
      return {
        status: 'started' as const,
        execution: { kind: 'candidate_supply' as const } as never,
        completion: new Promise<import('@megumi/execution').ExecutionOutcome>((resolve) => {
          acceptExecution = () => resolve({ status: 'completed' });
        }),
      };
    });
    const attempts = attemptStub();
    const runtime = createCandidateSupplyRuntime(runtimeOptions({ repository, startExecution, attempts }));

    await runtime.start();
    await vi.waitFor(() => expect(startExecution).toHaveBeenCalledTimes(1));
    const request = startExecution.mock.calls[0]![0];
    expect(request).toMatchObject({ kind: 'candidate_supply', trigger: 'startup' });
    expect(request).not.toHaveProperty('material');
    runtime.notify('interest_changed');
    runtime.notify('configuration_changed');
    expect(startExecution).toHaveBeenCalledTimes(1);
    acceptExecution?.();
    await vi.waitFor(() => expect(attempts.dispose).toHaveBeenCalledWith('execution:supply'));
    expect(startExecution).toHaveBeenCalledTimes(1);
    await runtime.shutdown();
  });

  it('includes configured cooling Sources in Context while allowing only ready Sources to start the run', async () => {
    const cooling = source('source:2');
    cooling.getAvailability = () => ({
      state: 'rate_limited',
      retryAt: '2026-08-27T01:00:00.000Z',
    });
    const startExecution = vi.fn(async (request: import('@megumi/execution').CandidateSupplyExecutionInput) => ({
      status: 'started' as const,
      execution: { kind: 'candidate_supply' as const } as never,
      completion: Promise.resolve({ status: 'completed' as const }),
    }));
    const runtime = createCandidateSupplyRuntime(runtimeOptions({
      repository,
      startExecution,
      sourceRegistry: createSourceRegistry([source(), cooling]),
      enabledSourceIds: ['source:1', 'source:2'],
    }));

    await runtime.start();
    await vi.waitFor(() => expect(startExecution).toHaveBeenCalledTimes(1));

    expect(startExecution.mock.calls[0]![0]).not.toHaveProperty('material');
    await runtime.shutdown();
  });

  it('starts when a consumer reports an explicit shortfall even above the inventory low watermark', async () => {
    seedAvailableCandidate(repository);
    const startExecution = vi.fn(async (request: import('@megumi/execution').CandidateSupplyExecutionInput) => ({
      status: 'started' as const,
      execution: { kind: 'candidate_supply' as const } as never,
      completion: Promise.resolve({ status: 'completed' as const }),
    }));
    const runtime = createCandidateSupplyRuntime({
      ...runtimeOptions({ repository, startExecution }),
      consumerShortfalls: () => ({ daily: 1 }),
    });

    await runtime.start();
    await vi.waitFor(() => expect(startExecution).toHaveBeenCalledTimes(1));

    expect(startExecution.mock.calls[0]![0]).toMatchObject({ trigger: 'startup' });
    await runtime.shutdown();
  });

  it('waits for the earliest retry when every enabled Source is unavailable', async () => {
    const retryAt = '2026-08-27T00:05:00.000Z';
    const startExecution = vi.fn();
    const resolveModel = vi.fn(async () => ({ status: 'ok' as const, model }));
    const timerSet = vi.fn(() => 'timer');
    const unavailable = source();
    unavailable.getAvailability = () => ({ state: 'rate_limited', retryAt });
    const runtime = createCandidateSupplyRuntime({
      ...runtimeOptions({ repository, startExecution, resolveModel }),
      sourceRegistry: createSourceRegistry([unavailable]),
      timers: { set: timerSet, clear: vi.fn() },
    });

    await runtime.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(resolveModel).not.toHaveBeenCalled();
    expect(startExecution).not.toHaveBeenCalled();
    expect(timerSet).toHaveBeenCalledWith(5 * 60_000, expect.any(Function));
    expect(repository.readSupplyState()).toMatchObject({
      retryAt,
      nextRecheckAt: retryAt,
      lastSettlement: {
        reason: 'no_available_source',
        remainingGap: { totalShortfall: 2 },
      },
    });
    await runtime.shutdown();
  });

  it('records a structured zero-yield settlement when two successful searches leave the gap open', async () => {
    const attempts = {
      ...attemptStub(),
      summarize: vi.fn(() => ({
        searchesStarted: 2, searchesSucceeded: 2, sourceFailures: 0,
        readsStarted: 0, rawResultsReceived: 0, admissionCommits: 0,
        admittedCandidates: 0, rejectedCandidates: 0, needsDetailCandidates: 0,
      })),
    } as CandidateSupplyAttempts;
    const startExecution = vi.fn(async (request: import('@megumi/execution').CandidateSupplyExecutionInput) => {
      await request.accept({ executionId: 'execution:zero' });
      return {
        status: 'started' as const,
        execution: { kind: 'candidate_supply' as const } as never,
        completion: Promise.resolve({ status: 'completed' as const }),
      };
    });
    const runtime = createCandidateSupplyRuntime(runtimeOptions({ repository, startExecution, attempts }));

    await runtime.start();
    await vi.waitFor(() => expect(repository.readSupplyState()?.lastSettlement).toMatchObject({
      executionId: 'execution:zero',
      reason: 'zero_yield',
      remainingGap: { totalShortfall: 2 },
    }));

    await runtime.shutdown();
  });

  it('settles as fulfilled and clears backoff when an external state change closes the gap', async () => {
    seedAvailableCandidate(repository);
    let dailyShortfall = 1;
    let finishExecution: (() => void) | undefined;
    const startExecution = vi.fn(async (request: import('@megumi/execution').CandidateSupplyExecutionInput) => {
      await request.accept({ executionId: 'execution:externally-fulfilled' });
      return {
        status: 'started' as const,
        execution: { kind: 'candidate_supply' as const } as never,
        completion: new Promise<import('@megumi/execution').ExecutionOutcome>((resolve) => {
          finishExecution = () => resolve({ status: 'completed' });
        }),
      };
    });
    const runtime = createCandidateSupplyRuntime({
      ...runtimeOptions({ repository, startExecution }),
      consumerShortfalls: () => ({ daily: dailyShortfall }),
    });

    await runtime.start();
    await vi.waitFor(() => expect(startExecution).toHaveBeenCalledTimes(1));
    dailyShortfall = 0;
    finishExecution?.();
    await vi.waitFor(() => expect(repository.readSupplyState()).toMatchObject({
      consecutiveZeroYieldCount: 0,
      lastSettlement: { reason: 'fulfilled', remainingGap: { totalShortfall: 0 } },
    }));

    await runtime.shutdown();
  });
});

function runtimeOptions(overrides: {
  repository: DiscoveryRepository;
  startExecution?: import('@megumi/discovery').CreateCandidateSupplyRuntimeOptions['startExecution'];
  resolveModel?: import('@megumi/discovery').CreateCandidateSupplyRuntimeOptions['resolveModel'];
  attempts?: CandidateSupplyAttempts;
  timers?: import('@megumi/discovery').CreateCandidateSupplyRuntimeOptions['timers'];
  sourceRegistry?: import('@megumi/discovery').SourceRegistry;
  enabledSourceIds?: readonly string[];
}): import('@megumi/discovery').CreateCandidateSupplyRuntimeOptions {
  return {
    repository: overrides.repository,
    attempts: overrides.attempts ?? attemptStub(),
    sourceRegistry: overrides.sourceRegistry ?? createSourceRegistry([source()]),
    settings: {
      read: () => ({
        conversationRecognitionEnabled: false, dailyGenerationTime: '08:00',
        dailyTargetCount: 1, enabledSources: overrides.enabledSourceIds ?? ['source:1'],
      }),
      write: () => undefined,
    },
    startExecution: overrides.startExecution ?? (async () => ({
      status: 'failed', failure: { code: 'internal_error', message: 'not used', retryable: false },
    })),
    resolveModel: overrides.resolveModel ?? (async () => ({ status: 'ok', model })),
    now: () => now,
    ...(overrides.timers ? { timers: overrides.timers } : {
      timers: { set: () => 'timer', clear: () => undefined },
    }),
  };
}

function attemptStub(): CandidateSupplyAttempts {
  return {
    start: vi.fn(), ownsExecution: vi.fn(() => true), dispose: vi.fn(),
    summarize: vi.fn(() => undefined),
    searchContent: vi.fn(), readSourceCandidate: vi.fn(), commitCandidateAdmission: vi.fn(),
  };
}

function source(id = 'source:1'): DiscoverySource {
  return {
    descriptor: {
      id, name: `Source ${id}`, access: 'public_http',
      supportedModes: ['relevance'], supportsRead: false,
    },
    getAvailability: () => ({ state: 'ready' }),
    async search() { return { status: 'success', items: [] }; },
  };
}

function seedAvailableCandidate(repository: DiscoveryRepository): void {
  repository.beginQuery({
    queryId: 'query:1', executionId: 'execution:seed', sourceId: 'source:1', query: 'seed',
    mode: 'relevance', targetInterestIds: [], startedAt: now,
  });
  const candidate = repository.commitSearchResult({
    queryId: 'query:1', completedAt: now, hardLimit: 4,
    items: [{
      sourceId: 'source:1', sourceName: 'Source 1', sourceContentId: 'article:1',
      canonicalUrl: 'https://example.com/article/1', contentType: 'article',
      title: 'Useful article', description: 'Substantive content.',
    }],
  }).candidates[0]!;
  repository.commitAdmission({
    executionId: 'execution:seed', assessmentVersion: 'candidate-admission:v1', assessedAt: now,
    decisions: [{
      candidateId: candidate.candidateId, decision: 'admit', relevance: 'exploration', matchedInterestIds: [],
      contentValue: 'substantive', novelty: 'novel', temporalValidity: 'valid',
      negativeConstraint: 'clear', reason: 'Useful exploration.',
      interestRevisions: [], preferenceRevisions: [], preferenceAlignment: [],
    }],
  });
}
