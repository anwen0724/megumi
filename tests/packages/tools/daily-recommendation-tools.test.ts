/* Verifies Daily Recommendation's local-read and terminal-publication Tool seam. */
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase, type DatabaseConnection } from '@megumi/database';
import {
  createDailyRecommendationAttempts,
  createDailyRecommendationRepository,
  createDiscoveryRepository,
} from '@megumi/discovery';
import { createTools } from '@megumi/tools';

const now = '2026-08-27T08:00:00.000Z';

describe('Daily Recommendation Tools', () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
  });

  afterEach(() => database.close());

  it('exposes only local Candidate reading and terminal publication to the Agent', async () => {
    const discovery = createDiscoveryRepository({ database, clock: { now: () => now } });
    discovery.applyInterestChange({
      action: 'create', interestId: 'interest:1', description: 'Agent architecture', now,
    });
    const submission = discovery.submitCandidate({
      content: {
        sourceId: 'open_web', sourceName: 'example.com', sourceContentId: 'guide',
        canonicalUrl: 'https://example.com/guide', contentType: 'article', title: 'Agent guide',
        description: 'A compact description.',
      },
      selectionReason: 'Related to the active Agent architecture Interest.',
      matches: [{ interestId: 'interest:1', relevance: 'direct' }],
      settings: {
        minimumCount: 100,
        targetCount: 160,
        maximumCount: 200,
        candidateValidityDays: 30,
      },
    });
    if (submission.status !== 'created') throw new Error('Expected Candidate material.');
    const candidate = submission.candidate;

    const repository = createDailyRecommendationRepository(database);
    const snapshot = repository.readSnapshot({ now, requestedCount: 1 });
    repository.claimBatch({
      batchId: 'batch:1', localDate: '2026-08-27', timezone: 'Asia/Shanghai',
      executionId: 'execution:daily', requestedCount: 1, actualTarget: 1, now,
    });
    const attempts = createDailyRecommendationAttempts();
    attempts.start({
      executionId: 'execution:daily', batchId: 'batch:1', snapshot,
      repository, createRecommendationId: () => 'recommendation:1', now: () => now,
    });
    const tools = createTools({
      ...toolInfrastructure(),
      dailyRecommendationTools: attempts,
    });
    const execution = tools.bindExecution({
      executionId: 'execution:daily', subject: { kind: 'background' }, toolGroupId: 'daily_recommendation',
    });
    if (execution.status !== 'bound') throw new Error('Expected Daily Recommendation Tool binding.');
    const modelCall = execution.binding.prepareModelCall({ modelCallId: 'model-call:daily' });
    if (modelCall.status !== 'prepared') throw new Error('Expected Tool definitions.');

    expect(modelCall.binding.definitions.map(({ name }) => name)).toEqual([
      'update_plan',
      'read_pool_candidate',
      'publish_daily_recommendations',
    ]);
    const read = modelCall.binding.routeToolCall({
      toolCallId: 'call:read', toolName: 'read_pool_candidate', input: { candidateId: candidate.id },
    });
    if (read.status !== 'routed') throw new Error('Expected local read Tool routing.');
    await expect(modelCall.binding.executeToolInvocation({ invocation: read.invocation })).resolves.toMatchObject({
      type: 'succeeded',
      normalizedResult: { kind: 'json', content: expect.stringContaining(candidate.id) },
    });

    const publish = modelCall.binding.routeToolCall({
      toolCallId: 'call:publish',
      toolName: 'publish_daily_recommendations',
      input: { items: [{ candidateId: candidate.id, recommendationReason: 'Directly useful today.' }] },
    });
    if (publish.status !== 'routed') throw new Error('Expected publication Tool routing.');
    await expect(modelCall.binding.executeToolInvocation({ invocation: publish.invocation })).resolves.toMatchObject({
      type: 'succeeded',
      normalizedResult: { kind: 'json', content: expect.stringContaining('"status": "published"') },
    });
    expect(repository.getBatch('2026-08-27')).toMatchObject({ status: 'published', resultCount: 1 });
  });
});

function toolInfrastructure() {
  return {
    settings: {
      resolveWebSearch: () => ({ status: 'failed' as const }),
      readWebSearchApiKey: () => ({ status: 'missing' as const }),
    },
    workspaces: { getWorkspace: () => { throw new Error('Daily Recommendation has no Workspace.'); } },
    workspaceChanges: { trackToolExecution: ({ execute }: { readonly execute: () => Promise<unknown> }) => execute() },
    sandbox: {
      capabilities: () => ({
        platform: 'win32' as const, workspaceEffectObservation: true, fileReadBoundary: true,
        fileWriteBoundary: true, environmentIsolation: true, networkIsolation: true,
        processTreeTermination: true, timeLimit: true, outputLimit: true,
        processCountLimit: true, cpuLimit: false, memoryLimit: false,
      }),
      open: async () => ({ status: 'unavailable' as const, reason: 'Daily Recommendation has no Sandbox.' }),
    },
    executionPolicy: { maxExecutionTimeMs: 1_000, maxOutputBytes: 20_000, maxProcessCount: 4 },
  };
}
