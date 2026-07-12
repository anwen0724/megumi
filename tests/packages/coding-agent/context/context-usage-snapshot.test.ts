/*
 * Verifies synchronous completed-Run usage snapshot writes and cache-only reads.
 */
import { describe, expect, it, vi } from 'vitest';
import { ContextServiceImpl } from '@megumi/coding-agent/context/service/context-service-impl';
import type { ContextServiceDependencies } from '@megumi/coding-agent/context/service/context-service-impl';

function fixture() {
  const cache = new Map();
  const count = vi.fn();
  const dependencies = {
    sessionService: { getActiveHistory: vi.fn(), saveCompactionSummary: vi.fn() },
    runHistoryQuery: { getHistoricalRun: vi.fn() },
    instructionScopeResolver: { resolve: vi.fn() },
    instructionService: { getSystemInstructions: vi.fn(), getEffectiveAgentInstructions: vi.fn() },
    skillService: { getSkillCatalog: vi.fn() },
    promptTokenCounter: { count }, summaryModelCall: { complete: vi.fn() }, usageSnapshotCache: cache,
    clock: { now: () => '2026-07-12T00:00:00.000Z' },
  } as unknown as ContextServiceDependencies;
  return { service: new ContextServiceImpl(dependencies), count };
}

const modelContext = { providerId: 'openai', modelId: 'gpt', contextWindowTokens: 1000 };
const estimatedUsage = { usedTokens: 500, contextWindowTokens: 1000, remainingTokens: 500, usedRatio: 0.5, compactionThresholdRatio: 0.8 };

describe('completed Run usage snapshots', () => {
  it('prefers provider input tokens and preserves completed history at or above the window', () => {
    const { service } = fixture();
    expect(service.recordCompletedRunUsage({ sessionId: 'S1', runId: 'R1', modelContext, preCallUsage: estimatedUsage, providerInputTokens: 1000 })).toMatchObject({
      status: 'recorded', snapshot: { accuracy: 'provider_reported', calculatedAt: '2026-07-12T00:00:00.000Z', usage: { usedTokens: 1000, remainingTokens: 0, usedRatio: 1 } },
    });
  });

  it('uses estimated usage, overwrites the Session cache, and querying never recalculates', () => {
    const { service, count } = fixture();
    service.recordCompletedRunUsage({ sessionId: 'S1', runId: 'R1', modelContext, preCallUsage: estimatedUsage });
    service.recordCompletedRunUsage({ sessionId: 'S1', runId: 'R2', modelContext, preCallUsage: { ...estimatedUsage, usedTokens: 600, remainingTokens: 400, usedRatio: 0.6 } });
    expect(service.getSessionUsageSnapshot({ sessionId: 'S1' })).toMatchObject({ status: 'available', snapshot: { runId: 'R2', accuracy: 'estimated', usage: { usedTokens: 600 } } });
    expect(service.getSessionUsageSnapshot({ sessionId: 'S2' })).toEqual({ status: 'not_available' });
    expect(count).not.toHaveBeenCalled();
  });

  it('rejects invalid snapshot input without overwriting the cache', () => {
    const { service } = fixture();
    service.recordCompletedRunUsage({ sessionId: 'S1', runId: 'R1', modelContext, preCallUsage: estimatedUsage });
    expect(service.recordCompletedRunUsage({ sessionId: 'S1', runId: 'R2', modelContext, preCallUsage: estimatedUsage, providerInputTokens: -1 })).toMatchObject({ status: 'failed', failure: { code: 'usage_snapshot_invalid' } });
    expect(service.getSessionUsageSnapshot({ sessionId: 'S1' })).toMatchObject({ status: 'available', snapshot: { runId: 'R1' } });
  });
});
