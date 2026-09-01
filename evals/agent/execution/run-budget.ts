/* Tracks Run limits and stops new Tasks without converting budget exhaustion to quality failure. */
import type { EvaluationRunConfig } from '../contracts/evaluation-run-config';
import type { EvaluationMeasurements } from './observe-task';

export interface EvaluationRunBudget {
  canStartTask(): boolean;
  record(measurements: EvaluationMeasurements): void;
  snapshot(): Readonly<Record<string, number>>;
}

export function createRunBudget(config: EvaluationRunConfig['budget']): EvaluationRunBudget {
  let startedTasks = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let estimatedCostUsd = 0;
  return {
    canStartTask() {
      if (startedTasks >= config.maxTasks) return false;
      if (config.maxInputTokens !== undefined && inputTokens >= config.maxInputTokens) return false;
      if (config.maxOutputTokens !== undefined && outputTokens >= config.maxOutputTokens) return false;
      if (config.maxEstimatedCostUsd !== undefined && estimatedCostUsd >= config.maxEstimatedCostUsd) return false;
      startedTasks += 1;
      return true;
    },
    record(measurements) {
      inputTokens += measurements.inputTokens + measurements.graderInputTokens;
      outputTokens += measurements.outputTokens + measurements.graderOutputTokens;
      estimatedCostUsd += measurements.estimatedCostUsd + measurements.graderEstimatedCostUsd;
    },
    snapshot: () => ({ startedTasks, inputTokens, outputTokens, estimatedCostUsd }),
  };
}
