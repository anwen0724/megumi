/* Verifies Candidate Supply check receipts and trigger coalescing at the Runtime boundary. */
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabase, migrateDatabase, type DatabaseConnection } from '@megumi/database';
import {
  createCandidateSupplyAttempts,
  createCandidateSupplyRuntime,
  createDiscoveryRepository,
  createOpenWebSource,
  createSourceRegistry,
} from '@megumi/discovery';

let database: DatabaseConnection | undefined;
afterEach(() => database?.close());

describe('Candidate Supply Runtime', () => {
  it('persists one queued rerun for repeated triggers while a check is settling', async () => {
    database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
    const repository = createDiscoveryRepository({ database });
    let id = 0;
    const runtime = createCandidateSupplyRuntime({
      repository,
      attempts: createCandidateSupplyAttempts(),
      sourceRegistry: createSourceRegistry([createOpenWebSource({
        webSearch: { search: async (request) => ({ query: request.query, results: [] }) },
        webFetch: { fetch: async () => { throw new Error('Fetch is not expected.'); } },
      })]),
      settings: {
        read: () => ({
          conversationRecognitionEnabled: true,
          dailyGenerationTime: '08:00',
          dailyTargetCount: 0,
          enabledSources: ['open_web'],
        }),
        write: () => undefined,
      },
      startExecution: async () => { throw new Error('A no-gap check must not start an Agent Execution.'); },
      resolveModel: async () => { throw new Error('A no-gap check must not resolve a model.'); },
      now: () => '2026-01-01T00:00:00.000Z',
      ids: { createCheckId: () => `candidate-supply-check:${++id}` },
      timers: { set: () => Symbol('timer'), clear: () => undefined },
    });

    const starting = runtime.start();
    const queued = runtime.notify('interest_changed');
    const merged = runtime.notify('consumer_shortfall');
    await starting;
    expect(queued).toBeDefined();
    expect(merged?.candidateSupplyId).toBe(queued?.candidateSupplyId);
    if (!queued) return;

    await vi.waitFor(() => {
      expect(runtime.getCheck(queued.candidateSupplyId)).toMatchObject({
        status: 'completed', reason: 'no_gap',
      });
    });
    await runtime.shutdown();
  });

  it('settles model resolution failure distinctly from an Agent Execution failure', async () => {
    database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
    const repository = createDiscoveryRepository({ database });
    const runtime = createCandidateSupplyRuntime({
      repository,
      attempts: createCandidateSupplyAttempts(),
      sourceRegistry: createSourceRegistry([createOpenWebSource({
        webSearch: { search: async (request) => ({ query: request.query, results: [] }) },
        webFetch: { fetch: async () => { throw new Error('Fetch is not expected.'); } },
      })]),
      settings: {
        read: () => ({
          conversationRecognitionEnabled: true,
          dailyGenerationTime: '08:00',
          dailyTargetCount: 1,
          enabledSources: ['open_web'],
        }),
        write: () => undefined,
      },
      startExecution: async () => { throw new Error('No Agent Execution should start without a model.'); },
      resolveModel: async () => ({ status: 'failed', code: 'model_missing', message: 'Model unavailable.' }),
      now: () => '2026-01-01T00:00:00.000Z',
      ids: { createCheckId: () => 'candidate-supply-check:model' },
      timers: { set: () => Symbol('timer'), clear: () => undefined },
    });

    const receipt = runtime.notify('evaluation');
    if (!receipt) throw new Error('Expected a Candidate Supply Check receipt.');
    await vi.waitFor(() => {
      expect(runtime.getCheck(receipt.candidateSupplyId)).toMatchObject({
        status: 'completed', reason: 'model_unavailable',
      });
    });
    await runtime.shutdown();
  });
});
