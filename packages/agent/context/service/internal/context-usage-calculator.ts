/*
 * Derives Context-window usage from a validated token estimate and Context policy.
 */
import type {
  ContextCapacity,
  ContextPolicy,
  ContextUsage,
} from '../../domain/model/context-usage';

export type CalculateContextUsageRequest = {
  inputTokens: number;
  capacity: ContextCapacity;
  policy: ContextPolicy;
};

export function calculateContextUsage(request: CalculateContextUsageRequest): ContextUsage {
  if (!Number.isInteger(request.inputTokens) || request.inputTokens < 0) {
    throw new RangeError('inputTokens must be a nonnegative integer.');
  }

  if (
    !Number.isInteger(request.capacity.contextWindowTokens)
    || request.capacity.contextWindowTokens <= 0
  ) {
    throw new RangeError('contextWindowTokens must be a positive integer.');
  }

  if (
    !Number.isFinite(request.policy.compactionThresholdRatio)
    || request.policy.compactionThresholdRatio <= 0
    || request.policy.compactionThresholdRatio >= 1
  ) {
    throw new RangeError('compactionThresholdRatio must be greater than 0 and less than 1.');
  }

  if (!Number.isInteger(request.policy.keepRecentRuns) || request.policy.keepRecentRuns < 0) {
    throw new RangeError('keepRecentRuns must be a nonnegative integer.');
  }

  return {
    usedTokens: request.inputTokens,
    contextWindowTokens: request.capacity.contextWindowTokens,
    remainingTokens: request.capacity.contextWindowTokens - request.inputTokens,
    usedRatio: request.inputTokens / request.capacity.contextWindowTokens,
    compactionThresholdRatio: request.policy.compactionThresholdRatio,
  };
}
