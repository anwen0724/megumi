/* Tracks Run limits and stops new Cases without converting budget exhaustion to quality failure. */
import type { EvaluationRunConfig } from '../catalog/evaluation-run-config';
import type { EvaluationMeasurements } from './evidence';

export interface EvaluationRunBudget {
  canStartCase(): boolean;
  record(measurements: EvaluationMeasurements): void;
  snapshot(): Readonly<Record<string, number>>;
}

export function createRunBudget(config: EvaluationRunConfig['budget']): EvaluationRunBudget {
  let startedCases = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let estimatedCostUsd = 0;
  return {
    canStartCase() {
      if (startedCases >= config.maxCases) return false;
      if (config.maxInputTokens !== undefined && inputTokens >= config.maxInputTokens) return false;
      if (config.maxOutputTokens !== undefined && outputTokens >= config.maxOutputTokens) return false;
      if (config.maxEstimatedCostUsd !== undefined && estimatedCostUsd >= config.maxEstimatedCostUsd) return false;
      startedCases += 1;
      return true;
    },
    record(measurements) {
      inputTokens += measurements.inputTokens + measurements.graderInputTokens;
      outputTokens += measurements.outputTokens + measurements.graderOutputTokens;
      estimatedCostUsd += measurements.estimatedCostUsd + measurements.graderEstimatedCostUsd;
    },
    snapshot: () => ({ startedCases, inputTokens, outputTokens, estimatedCostUsd }),
  };
}
