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
  modelContextWindow?: number;
  reservedOutputTokens?: number;
  availableInputTokens?: number;
  keepRecentTokens?: number;
  parts: ModelInputContextPartDraft[];
  excludedSources?: ModelInputContextExcludedSource[];
}

export const DEFAULT_MODEL_CONTEXT_WINDOW = 8192;
export const DEFAULT_RESERVED_OUTPUT_TOKENS = 1024;

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
  const modelContextWindow = input.budgetPolicy?.modelContextWindow
    ?? input.modelContextWindow
    ?? DEFAULT_MODEL_CONTEXT_WINDOW;
  const reservedOutputTokens = input.budgetPolicy?.reservedOutputTokens
    ?? input.reservedOutputTokens
    ?? DEFAULT_RESERVED_OUTPUT_TOKENS;
  const availableInputTokens = Math.max(0, modelContextWindow - reservedOutputTokens);
  const keepRecentTokens = input.budgetPolicy?.keepRecentTokens
    ?? input.keepRecentTokens
    ?? input.availableInputTokens
    ?? availableInputTokens;

  return {
    modelContextWindow,
    reservedOutputTokens,
    keepRecentTokens: Math.min(keepRecentTokens, availableInputTokens),
  };
}
