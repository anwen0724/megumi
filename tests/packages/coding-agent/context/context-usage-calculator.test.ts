/*
 * Verifies deterministic Context usage derivation and input validation.
 */
import { describe, expect, it } from 'vitest';
import { calculateContextUsage } from '@megumi/coding-agent/context/service/internal/context-usage-calculator';

describe('calculateContextUsage', () => {
  it('derives complete usage from counted input tokens and model capacity', () => {
    expect(calculateContextUsage({
      inputTokens: 800,
      capacity: { providerId: 'p', modelId: 'm', contextWindowTokens: 1000 },
      policy: { compactionThresholdRatio: 0.8, keepRecentTurns: 10 },
    })).toEqual({
      usedTokens: 800,
      contextWindowTokens: 1000,
      remainingTokens: 200,
      usedRatio: 0.8,
      compactionThresholdRatio: 0.8,
    });
  });

  it('preserves exceeded-window usage without hiding the token deficit', () => {
    expect(calculateContextUsage({
      inputTokens: 1001,
      capacity: { providerId: 'p', modelId: 'm', contextWindowTokens: 1000 },
      policy: { compactionThresholdRatio: 0.8, keepRecentTurns: 10 },
    })).toMatchObject({
      usedTokens: 1001,
      remainingTokens: -1,
      usedRatio: 1.001,
    });
  });

  it.each([
    ['negative tokens', -1, 1000, 0.8],
    ['fractional tokens', 1.5, 1000, 0.8],
    ['zero capacity', 1, 0, 0.8],
    ['fractional capacity', 1, 1000.5, 0.8],
    ['zero ratio', 1, 1000, 0],
    ['unit ratio', 1, 1000, 1],
  ])('rejects %s', (_label, inputTokens, contextWindowTokens, ratio) => {
    expect(() => calculateContextUsage({
      inputTokens,
      capacity: { providerId: 'p', modelId: 'm', contextWindowTokens },
      policy: { compactionThresholdRatio: ratio, keepRecentTurns: 10 },
    })).toThrow(RangeError);
  });
});
