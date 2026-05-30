import { z } from 'zod';

export const CONTEXT_BUDGET_WARNING_REASONS = [
  'required_context_over_budget',
] as const;
export type ContextBudgetWarningReason = (typeof CONTEXT_BUDGET_WARNING_REASONS)[number];

export const ContextBudgetPolicySchema = z
  .object({
    modelContextWindow: z.number().int().positive(),
    reservedOutputTokens: z.number().int().nonnegative(),
    keepRecentTokens: z.number().int().nonnegative(),
  })
  .strict();

export interface ContextBudgetPolicy {
  modelContextWindow: number;
  reservedOutputTokens: number;
  keepRecentTokens: number;
}

export const ContextBudgetWarningSchema = z
  .object({
    reason: z.enum(CONTEXT_BUDGET_WARNING_REASONS),
    tokenEstimate: z.number().int().nonnegative(),
    availableInputTokens: z.number().int().nonnegative(),
  })
  .strict();

export interface ContextBudgetWarning {
  reason: ContextBudgetWarningReason;
  tokenEstimate: number;
  availableInputTokens: number;
}
