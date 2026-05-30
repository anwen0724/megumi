import { describe, expect, it } from 'vitest';
import {
  CONTEXT_BUDGET_WARNING_REASONS,
  ContextBudgetPolicySchema,
  ContextBudgetWarningSchema,
  type ContextBudgetPolicy,
  type ContextBudgetWarning,
} from '@megumi/shared/context-budget-contracts';

describe('Context budget contracts', () => {
  it('parses strict context budget policies', () => {
    const parsed = ContextBudgetPolicySchema.parse({
      modelContextWindow: 8192,
      reservedOutputTokens: 1024,
      keepRecentTokens: 4096,
    });

    expect(parsed).toEqual({
      modelContextWindow: 8192,
      reservedOutputTokens: 1024,
      keepRecentTokens: 4096,
    } satisfies ContextBudgetPolicy);
  });

  it('rejects invalid policy values and unknown fields', () => {
    expect(() => ContextBudgetPolicySchema.parse({
      modelContextWindow: 0,
      reservedOutputTokens: 1024,
      keepRecentTokens: 4096,
    })).toThrow();

    expect(() => ContextBudgetPolicySchema.parse({
      modelContextWindow: 8192,
      reservedOutputTokens: -1,
      keepRecentTokens: 4096,
    })).toThrow();

    expect(() => ContextBudgetPolicySchema.parse({
      modelContextWindow: 8192,
      reservedOutputTokens: 1024,
      keepRecentTokens: 4096,
      availableInputTokens: 7168,
    })).toThrow();
  });

  it('parses required context over budget warnings', () => {
    const parsed = ContextBudgetWarningSchema.parse({
      reason: 'required_context_over_budget',
      tokenEstimate: 9000,
      availableInputTokens: 7168,
    });

    expect(parsed).toEqual({
      reason: 'required_context_over_budget',
      tokenEstimate: 9000,
      availableInputTokens: 7168,
    } satisfies ContextBudgetWarning);
  });

  it('exports stable warning reasons', () => {
    expect(CONTEXT_BUDGET_WARNING_REASONS).toEqual([
      'required_context_over_budget',
    ]);
  });
});
