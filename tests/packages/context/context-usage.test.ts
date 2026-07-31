/* Verifies completed Model Call usage prefers provider facts and falls back to build estimates. */
import type { Api, Model } from '@megumi/ai';
import { describe, expect, it, vi } from 'vitest';
import { createContext, type CreateContextOptions } from '../../../packages/context/src/index';

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

const estimatedUsage = {
  usedTokens: 500,
  contextWindowTokens: 1000,
  remainingTokens: 500,
  usedRatio: 0.5,
  compactionThresholdRatio: 0.8,
};

function options(): CreateContextOptions {
  return {
    sessionHistory: { getActiveHistory: vi.fn(), saveCompactionSummary: vi.fn() },
    attachmentReader: { readAttachmentContent: vi.fn() },
    instructionScopeResolver: { resolve: vi.fn() },
    instructionReader: { getSystemInstructions: vi.fn(), getEffectiveInstructions: vi.fn() },
    models: { completeSimple: vi.fn() },
    clock: { now: () => '2026-07-12T00:00:00.000Z' },
  } as unknown as CreateContextOptions;
}

describe('Context usage snapshot', () => {
  it('records provider input usage and retains a completed call at the full window', () => {
    const context = createContext(options());
    expect(context.recordCompletedModelCall({
      sessionId: 'session:1',
      runId: 'run:1',
      model,
      preCallUsage: estimatedUsage,
      providerInputTokens: 1000,
    })).toMatchObject({
      status: 'recorded',
      snapshot: {
        accuracy: 'provider_reported',
        calculatedAt: '2026-07-12T00:00:00.000Z',
        usage: { usedTokens: 1000, remainingTokens: 0, usedRatio: 1 },
      },
    });
  });

  it('uses the pre-call estimate, replaces the Session snapshot, and never rebuilds on read', () => {
    const context = createContext(options());
    context.recordCompletedModelCall({
      sessionId: 'session:1',
      runId: 'run:1',
      model,
      preCallUsage: estimatedUsage,
    });
    context.recordCompletedModelCall({
      sessionId: 'session:1',
      runId: 'run:2',
      model,
      preCallUsage: { ...estimatedUsage, usedTokens: 600, remainingTokens: 400, usedRatio: 0.6 },
    });

    expect(context.getSessionUsage({ sessionId: 'session:1' })).toMatchObject({
      status: 'available',
      snapshot: { runId: 'run:2', accuracy: 'estimated', usage: { usedTokens: 600 } },
    });
    expect(context.getSessionUsage({ sessionId: 'session:2' })).toEqual({ status: 'not_available' });
  });

  it('rejects invalid provider usage without overwriting a previous valid snapshot', () => {
    const context = createContext(options());
    context.recordCompletedModelCall({
      sessionId: 'session:1',
      runId: 'run:1',
      model,
      preCallUsage: estimatedUsage,
    });
    expect(context.recordCompletedModelCall({
      sessionId: 'session:1',
      runId: 'run:2',
      model,
      preCallUsage: estimatedUsage,
      providerInputTokens: -1,
    })).toMatchObject({ status: 'failed', failure: { code: 'usage_snapshot_invalid' } });
    expect(context.getSessionUsage({ sessionId: 'session:1' })).toMatchObject({
      status: 'available',
      snapshot: { runId: 'run:1' },
    });
  });
});
