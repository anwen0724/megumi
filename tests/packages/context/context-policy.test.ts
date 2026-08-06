/* Verifies Policy merging, validation, threshold and final Context Window rules. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_COMPACTION_POLICY } from '../../../packages/context/src/index';
import type { ContextCapacity } from '../../../packages/context/src/index';
import {
  compactionPolicyFailure,
  finalContextWindowProblem,
  resolveCompactionPolicy,
  shouldAutoCompact,
  validateTokenCount,
  type CompactionPolicy,
} from '../../../packages/context/src/context-policy';

const capacity: ContextCapacity = {
  providerId: 'openai',
  modelId: 'gpt',
  contextWindowTokens: 1000,
};

describe('Compaction Policy', () => {
  it('merges default, static and dynamic configuration in that order', () => {
    // Nothing configured: the defaults apply.
    expect(resolveCompactionPolicy(undefined, undefined)).toEqual(DEFAULT_COMPACTION_POLICY);
    // Static configuration overrides the defaults.
    expect(resolveCompactionPolicy({ reserveTokens: 100 }, undefined)).toMatchObject({
      reserveTokens: 100,
      keepRecentTokens: DEFAULT_COMPACTION_POLICY.keepRecentTokens,
    });
    // Dynamic (provider) configuration wins over static configuration.
    expect(resolveCompactionPolicy(
      { reserveTokens: 100, keepRecentTokens: 5 },
      { reserveTokens: 200 },
    )).toMatchObject({ reserveTokens: 200, keepRecentTokens: 5 });
  });

  it('rejects illegal Token configurations', () => {
    expect(() => resolveCompactionPolicy({ reserveTokens: -1 }, undefined)).toThrow(RangeError);
    expect(() => resolveCompactionPolicy({ keepRecentTokens: 1.5 }, undefined)).toThrow(RangeError);
    expect(() => validateTokenCount(NaN, 'reserveTokens')).toThrow(RangeError);
  });

  it('rejects a reserve that fills the whole Context Window', () => {
    const problem = compactionPolicyFailure(
      { ...DEFAULT_COMPACTION_POLICY, reserveTokens: 1000 },
      capacity,
    );
    expect(problem).toContain('leaves no usable Context Window');
    // The default reserve fits a normal Model Context Window.
    expect(compactionPolicyFailure(
      DEFAULT_COMPACTION_POLICY,
      { ...capacity, contextWindowTokens: 20_000 },
    )).toBeUndefined();
  });

  it('triggers automatic compaction only above the reserved threshold', () => {
    const policy: CompactionPolicy = {
      ...DEFAULT_COMPACTION_POLICY,
      enabled: true,
      reserveTokens: 100,
    };
    // 900 tokens leave exactly the 100-token reserve: no compaction needed.
    expect(shouldAutoCompact({ policy, promptTokens: 900, contextWindowTokens: 1000 })).toBe(false);
    expect(shouldAutoCompact({ policy, promptTokens: 901, contextWindowTokens: 1000 })).toBe(true);
    // Disabled policy never triggers automatic compaction.
    expect(shouldAutoCompact({ policy: { ...policy, enabled: false }, promptTokens: 999, contextWindowTokens: 1000 })).toBe(false);
  });

  it('validates the final Prompt against the Context Window', () => {
    expect(finalContextWindowProblem({ promptTokens: 999, contextWindowTokens: 1000 })).toBeUndefined();
    // Reaching or exceeding the Window is a hard failure.
    expect(finalContextWindowProblem({ promptTokens: 1000, contextWindowTokens: 1000 })).toContain('1000-token Context Window');
    expect(finalContextWindowProblem({ promptTokens: 1001, contextWindowTokens: 1000 })).toContain('1001 tokens');
  });
});
