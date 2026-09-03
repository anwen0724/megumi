/* Verifies Candidate Supply triggering, single execution ownership, and database-based settlement. */
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api, Model } from '@megumi/ai';
import { createDatabase, migrateDatabase, type DatabaseConnection } from '@megumi/database';
import {
  createCandidateSupplyAttempts,
  createCandidateSupplyRuntime,
  createDiscoveryRepository,
  createSourceRegistry,
  type DiscoveryRepository,
  type DiscoverySource,
} from '@megumi/discovery';

const now = '2026-09-03T00:00:00.000Z';
const model: Model<Api> = {
  id: 'model:1', name: 'Model', api: 'test-api', provider: 'test-provider',
  baseUrl: 'https://example.invalid', reasoning: false, input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8_192, maxTokens: 1_024,
};

describe('Candidate Supply Runtime', () => {
  let database: DatabaseConnection;
  let repository: DiscoveryRepository;

  beforeEach(() => {
    database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
    repository = createDiscoveryRepository({ database });
  });

  afterEach(() => database.close());

  it('does not start without an active Interest', async () => {
    const startExecution = vi.fn();
    const runtime = createCandidateSupplyRuntime(runtimeOptions({ startExecution }));

    await expect(runtime.requestCheck('startup')).resolves.toMatchObject({
      status: 'not_needed',
      reason: 'no_active_interest',
      addedCandidateCount: 0,
      addedInterestMatchCount: 0,
    });
    expect(startExecution).not.toHaveBeenCalled();
  });

  it('does not start when the Pool is not below minimumCount', async () => {
    createInterest();
    for (const url of ['https://example.com/one', 'https://example.com/two']) {
      repository.submitCandidate({
        content: content(url),
        contentSummary: 'Related content.',
        matches: [{ interestId: 'interest:1', relevance: 'direct', matchReason: 'Related.' }],
        settings: poolSettings(),
      });
    }
    const startExecution = vi.fn();
    const runtime = createCandidateSupplyRuntime(runtimeOptions({ startExecution }));

    await expect(runtime.requestCheck('scheduled')).resolves.toMatchObject({
      status: 'not_needed',
      reason: 'no_gap',
    });
    expect(startExecution).not.toHaveBeenCalled();
  });

  it('settles fulfillment from final Candidate database facts', async () => {
    createInterest();
    const attempts = createCandidateSupplyAttempts();
    const runtime = createCandidateSupplyRuntime(runtimeOptions({
      attempts,
      async startExecution(request) {
        const accepted = await request.accept({ executionId: 'execution:1' });
        if (accepted.status !== 'accepted') return { status: 'rejected', reason: accepted.reason };
        for (const url of [
          'https://example.com/one',
          'https://example.com/two',
          'https://example.com/three',
          'https://example.com/four',
        ]) {
          repository.submitCandidate({
            content: content(url),
            contentSummary: 'Related content.',
            matches: [{ interestId: 'interest:1', relevance: 'direct', matchReason: 'Related.' }],
            settings: poolSettings(),
          });
        }
        return {
          status: 'started',
          execution: executionSnapshot('execution:1'),
          completion: Promise.resolve({ status: 'completed' }),
        };
      },
    }));

    await expect(runtime.requestCheck('interest_changed')).resolves.toMatchObject({
      status: 'fulfilled',
      executionId: 'execution:1',
      availableCount: 4,
      remainingReplenishmentCount: 0,
      addedCandidateCount: 4,
    });
  });

  it('returns supply_in_progress instead of starting a second execution', async () => {
    createInterest();
    let finish: ((value: { status: 'completed' }) => void) | undefined;
    const completion = new Promise<{ status: 'completed' }>((resolve) => {
      finish = resolve;
    });
    const startExecution = vi.fn(async (request) => {
      const accepted = await request.accept({ executionId: 'execution:1' });
      if (accepted.status !== 'accepted') return { status: 'rejected' as const, reason: accepted.reason };
      return {
        status: 'started' as const,
        execution: executionSnapshot('execution:1'),
        completion,
      };
    });
    const runtime = createCandidateSupplyRuntime(runtimeOptions({ startExecution }));

    const first = runtime.requestCheck('startup');
    await vi.waitFor(() => expect(startExecution).toHaveBeenCalledTimes(1));
    await expect(runtime.requestCheck('supply_conditions_changed')).resolves.toMatchObject({
      status: 'not_needed',
      reason: 'supply_in_progress',
    });
    finish?.({ status: 'completed' });
    await first;
    expect(startExecution).toHaveBeenCalledTimes(1);
  });

  it('waits for the active supply to settle during shutdown', async () => {
    createInterest();
    let finish: ((value: { status: 'completed' }) => void) | undefined;
    const completion = new Promise<{ status: 'completed' }>((resolve) => {
      finish = resolve;
    });
    const runtime = createCandidateSupplyRuntime(runtimeOptions({
      async startExecution(request) {
        const accepted = await request.accept({ executionId: 'execution:1' });
        if (accepted.status !== 'accepted') return { status: 'rejected', reason: accepted.reason };
        return {
          status: 'started',
          execution: executionSnapshot('execution:1'),
          completion,
        };
      },
    }));

    const supply = runtime.requestCheck('startup');
    let shutDown = false;
    const shutdown = runtime.shutdown().then(() => { shutDown = true; });
    await Promise.resolve();
    expect(shutDown).toBe(false);

    finish?.({ status: 'completed' });
    await Promise.all([supply, shutdown]);
    expect(shutDown).toBe(true);
  });

  it('returns unfulfilled when no enabled Source is currently ready', async () => {
    createInterest();
    const runtime = createCandidateSupplyRuntime(runtimeOptions({
      sourceRegistry: createSourceRegistry([]),
    }));

    await expect(runtime.requestCheck('startup')).resolves.toMatchObject({
      status: 'unfulfilled',
      reason: 'no_available_source',
      availableCount: 0,
      remainingReplenishmentCount: 4,
    });
  });

  it('preserves Agent Core failure codes and already committed Candidate counts', async () => {
    createInterest();
    const runtime = createCandidateSupplyRuntime(runtimeOptions({
      async startExecution(request) {
        const accepted = await request.accept({ executionId: 'execution:1' });
        if (accepted.status !== 'accepted') return { status: 'rejected', reason: accepted.reason };
        repository.submitCandidate({
          content: content(),
          contentSummary: 'Related content.',
          matches: [{ interestId: 'interest:1', relevance: 'direct', matchReason: 'Related.' }],
          settings: poolSettings(),
        });
        return {
          status: 'started',
          execution: executionSnapshot('execution:1'),
          completion: Promise.resolve({
            status: 'failed',
            failure: {
              code: 'execution_limit_reached',
              message: 'Agent Core limit reached.',
              retryable: false,
            },
          }),
        };
      },
    }));

    await expect(runtime.requestCheck('startup')).resolves.toMatchObject({
      status: 'failed',
      executionId: 'execution:1',
      availableCount: 1,
      remainingReplenishmentCount: 3,
      addedCandidateCount: 1,
      failure: { code: 'execution_limit_reached' },
    });
  });

  function createInterest(): void {
    repository.applyInterestChange({
      action: 'create', interestId: 'interest:1', description: 'Agent architecture', now,
    });
  }

  function runtimeOptions(overrides: {
    readonly attempts?: ReturnType<typeof createCandidateSupplyAttempts>;
    readonly sourceRegistry?: ReturnType<typeof createSourceRegistry>;
    readonly startExecution?: Parameters<typeof createCandidateSupplyRuntime>[0]['startExecution'];
  } = {}): Parameters<typeof createCandidateSupplyRuntime>[0] {
    let request = 0;
    return {
      repository,
      attempts: overrides.attempts ?? createCandidateSupplyAttempts(),
      sourceRegistry: overrides.sourceRegistry ?? createSourceRegistry([source()]),
      settings: {
        read: () => ({
          conversationRecognitionEnabled: true,
          recommendationGenerationTime: '08:00',
          recommendationTargetCount: 20,
          recommendationWorkingSetCount: 80,
          enabledSources: ['source:1'],
          candidatePoolMinimumCount: 2,
          candidatePoolMaximumCount: 5,
          candidateValidityDays: 30,
          candidateContentExcerptMaxCharacters: 8_000,
          candidateSupplyCheckIntervalMinutes: 360,
        }),
        write: () => undefined,
      },
      startExecution: overrides.startExecution ?? (async () => {
        throw new Error('Agent Execution was not expected.');
      }),
      resolveModel: async () => ({ status: 'ok', model }),
      now: () => now,
      ids: { createRequestId: () => `candidate-supply-request:${++request}` },
      timers: { set: () => Symbol('timer'), clear: () => undefined },
    };
  }
});

function poolSettings() {
  return {
    minimumCount: 2,
    targetCount: 4,
    maximumCount: 5,
    candidateValidityDays: 30,
    candidateContentExcerptMaxCharacters: 8_000,
  };
}

function source(): DiscoverySource {
  return {
    descriptor: {
      id: 'source:1', name: 'Source 1', access: 'public_http',
      supportedModes: ['relevance', 'recent'], supportsRead: false,
    },
    getAvailability: () => ({ state: 'ready' }),
    search: async () => ({ status: 'success', items: [] }),
  };
}

function content(url = 'https://example.com/article') {
  return {
    sourceId: 'source:1',
    sourceName: 'Source 1',
    sourceContentId: url.split('/').at(-1),
    canonicalUrl: url,
    contentType: 'article' as const,
    title: 'Agent architecture in practice',
    description: 'Concrete implementation patterns.',
  };
}

function executionSnapshot(executionId: string) {
  return {
    kind: 'candidate_supply' as const,
    executionId,
    requestId: 'candidate-supply-request:1',
    model,
    createdAt: now,
    startedAt: now,
    status: 'running' as const,
  };
}
