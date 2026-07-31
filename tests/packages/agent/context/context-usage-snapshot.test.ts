/*
 * Verifies synchronous completed-Run usage snapshot writes and cache-only reads.
 */
import { describe, expect, it, vi } from 'vitest';
import { ContextServiceImpl } from '@megumi/agent/context/service/context-service-impl';
import type { ContextServiceDependencies } from '@megumi/agent/context/service/context-service-impl';
import type { Api, Model } from '@megumi/ai';

function fixture() {
  const cache = new Map();
  const count = vi.fn();
  const dependencies = {
    sessionService: { getActiveHistory: vi.fn(), saveCompactionSummary: vi.fn() },
    instructionScopeResolver: { resolve: vi.fn() },
    instructionService: { getSystemInstructions: vi.fn(), getEffectiveAgentInstructions: vi.fn() },
    contextTokenEstimator: count, models: { completeSimple: vi.fn() }, usageSnapshotCache: cache,
    clock: { now: () => '2026-07-12T00:00:00.000Z' },
  } as unknown as ContextServiceDependencies;
  return { service: new ContextServiceImpl(dependencies), count };
}

const model: Model<Api> = {
  id: 'gpt',
  name: 'GPT',
  api: 'openai-completions',
  provider: 'openai',
  baseUrl: 'https://api.example.com/v1',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1000,
  maxTokens: 100,
};
const estimatedUsage = { usedTokens: 500, contextWindowTokens: 1000, remainingTokens: 500, usedRatio: 0.5, compactionThresholdRatio: 0.8 };

describe('completed Run usage snapshots', () => {
  it('prefers provider input tokens and preserves completed history at or above the window', () => {
    const { service } = fixture();
    expect(service.recordCompletedRunUsage({ sessionId: 'S1', runId: 'R1', model, preCallUsage: estimatedUsage, providerInputTokens: 1000 })).toMatchObject({
      status: 'recorded', snapshot: { accuracy: 'provider_reported', calculatedAt: '2026-07-12T00:00:00.000Z', usage: { usedTokens: 1000, remainingTokens: 0, usedRatio: 1 } },
    });
  });

  it('uses estimated usage, overwrites the Session cache, and querying never recalculates', () => {
    const { service, count } = fixture();
    service.recordCompletedRunUsage({ sessionId: 'S1', runId: 'R1', model, preCallUsage: estimatedUsage });
    service.recordCompletedRunUsage({ sessionId: 'S1', runId: 'R2', model, preCallUsage: { ...estimatedUsage, usedTokens: 600, remainingTokens: 400, usedRatio: 0.6 } });
    expect(service.getSessionUsageSnapshot({ sessionId: 'S1' })).toMatchObject({ status: 'available', snapshot: { runId: 'R2', accuracy: 'estimated', usage: { usedTokens: 600 } } });
    expect(service.getSessionUsageSnapshot({ sessionId: 'S2' })).toEqual({ status: 'not_available' });
    expect(count).not.toHaveBeenCalled();
  });

  it('rejects invalid snapshot input without overwriting the cache', () => {
    const { service } = fixture();
    service.recordCompletedRunUsage({ sessionId: 'S1', runId: 'R1', model, preCallUsage: estimatedUsage });
    expect(service.recordCompletedRunUsage({ sessionId: 'S1', runId: 'R2', model, preCallUsage: estimatedUsage, providerInputTokens: -1 })).toMatchObject({ status: 'failed', failure: { code: 'usage_snapshot_invalid' } });
    expect(service.getSessionUsageSnapshot({ sessionId: 'S1' })).toMatchObject({ status: 'available', snapshot: { runId: 'R1' } });
  });
});
