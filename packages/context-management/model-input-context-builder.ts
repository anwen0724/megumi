import type { ContextBudgetPolicy } from '@megumi/shared/context-budget-contracts';
import {
  ModelInputContextSchema,
  type ModelInputContext,
  type ModelInputContextExcludedSource,
} from '@megumi/shared/model-input-context-contracts';
import {
  applyContextBudget,
  type ModelInputContextPartDraft,
} from './context-budget';

export interface BuildModelInputContextInput {
  contextId: string;
  sessionId: string;
  runId: string;
  stepId: string;
  buildReason: string;
  builtAt: string;
  budgetPolicy?: ContextBudgetPolicy;
  parts: ModelInputContextPartDraft[];
  excludedSources?: ModelInputContextExcludedSource[];
}

export const DEFAULT_MODEL_CONTEXT_WINDOW = 8192;
export const DEFAULT_RESERVED_OUTPUT_TOKENS = 1024;
export const DEFAULT_CONTEXT_BUDGET_POLICY = {
  modelContextWindow: DEFAULT_MODEL_CONTEXT_WINDOW,
  reservedOutputTokens: DEFAULT_RESERVED_OUTPUT_TOKENS,
  keepRecentTokens: DEFAULT_MODEL_CONTEXT_WINDOW - DEFAULT_RESERVED_OUTPUT_TOKENS,
} satisfies ContextBudgetPolicy;

export function buildModelInputContext(input: BuildModelInputContextInput): ModelInputContext {
  const budgetedContext = applyContextBudget({
    parts: input.parts,
    policy: resolveContextBudgetPolicy(input),
    buildReason: input.buildReason,
    preExcludedSources: input.excludedSources,
  });

  return ModelInputContextSchema.parse({
    contextId: input.contextId,
    sessionId: input.sessionId,
    runId: input.runId,
    stepId: input.stepId,
    parts: budgetedContext.parts,
    budget: budgetedContext.budget,
    trace: budgetedContext.trace,
    builtAt: input.builtAt,
  });
}

function resolveContextBudgetPolicy(input: BuildModelInputContextInput): ContextBudgetPolicy {
  return input.budgetPolicy ?? DEFAULT_CONTEXT_BUDGET_POLICY;
}
