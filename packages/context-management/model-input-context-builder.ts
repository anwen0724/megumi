import {
  ModelInputContextSchema,
  type ModelInputContext,
  type ModelInputContextExcludedSource,
  type ModelInputContextPart,
  type ModelInputContextSelectedSource,
} from '@megumi/shared/model-input-context-contracts';

export interface BuildModelInputContextInput {
  contextId: string;
  sessionId: string;
  runId: string;
  stepId: string;
  buildReason: string;
  builtAt: string;
  modelContextWindow?: number;
  reservedOutputTokens?: number;
  availableInputTokens?: number;
  parts: ModelInputContextPart[];
  excludedSources?: ModelInputContextExcludedSource[];
}

export const DEFAULT_MODEL_CONTEXT_WINDOW = 8192;
export const DEFAULT_RESERVED_OUTPUT_TOKENS = 1024;

export function buildModelInputContext(input: BuildModelInputContextInput): ModelInputContext {
  const parts = input.parts.map((part): ModelInputContextPart & { tokenEstimate: number } => ({
    ...part,
    tokenEstimate: part.tokenEstimate ?? estimateModelInputContextTokens(textForPart(part)),
  }));
  const partBudgets = parts.map((part) => ({
    partId: part.partId,
    tokenEstimate: part.tokenEstimate,
    budgetStatus: part.budgetStatus,
  }));
  const modelContextWindow = input.modelContextWindow ?? DEFAULT_MODEL_CONTEXT_WINDOW;
  const reservedOutputTokens = input.reservedOutputTokens ?? DEFAULT_RESERVED_OUTPUT_TOKENS;

  return ModelInputContextSchema.parse({
    contextId: input.contextId,
    sessionId: input.sessionId,
    runId: input.runId,
    stepId: input.stepId,
    parts,
    budget: {
      modelContextWindow,
      reservedOutputTokens,
      availableInputTokens: input.availableInputTokens ?? Math.max(0, modelContextWindow - reservedOutputTokens),
      inputTokenEstimate: partBudgets.reduce((sum, partBudget) => sum + partBudget.tokenEstimate, 0),
      partBudgets,
    },
    trace: {
      buildReason: input.buildReason,
      selectedSources: selectedSourcesForParts(parts),
      excludedSources: input.excludedSources ?? [],
    },
    builtAt: input.builtAt,
  });
}

export function estimateModelInputContextTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

function selectedSourcesForParts(parts: ModelInputContextPart[]): ModelInputContextSelectedSource[] {
  const selectedSources = new Map<string, ModelInputContextSelectedSource>();
  for (const part of parts) {
    for (const sourceRef of part.sourceRefs) {
      if (!selectedSources.has(sourceRef.sourceId)) {
        selectedSources.set(sourceRef.sourceId, {
          sourceId: sourceRef.sourceId,
          reason: part.truncation?.reason ?? part.kind,
        });
      }
    }
  }
  return [...selectedSources.values()];
}

function textForPart(part: ModelInputContextPart): string {
  return part.text;
}
