/* Defines the Context window policy applied uniformly to build and compaction. */
import type { Api, Model } from '@megumi/ai';

export interface ContextCapacity {
  readonly providerId: string;
  readonly modelId: string;
  readonly contextWindowTokens: number;
}

export interface ContextPolicy {
  readonly compactionThresholdRatio: number;
  readonly keepRecentRuns: number;
}

export const DEFAULT_CONTEXT_POLICY: Readonly<ContextPolicy> = Object.freeze({
  compactionThresholdRatio: 0.8,
  keepRecentRuns: 3,
});

export function contextCapacityFromModel(model: Model<Api>): ContextCapacity {
  return {
    providerId: model.provider,
    modelId: model.id,
    contextWindowTokens: model.contextWindow,
  };
}

export function resolveContextPolicy(
  defaults: Partial<ContextPolicy> | undefined,
  configured: Partial<ContextPolicy> | undefined,
): ContextPolicy {
  const policy = {
    compactionThresholdRatio: configured?.compactionThresholdRatio
      ?? defaults?.compactionThresholdRatio
      ?? DEFAULT_CONTEXT_POLICY.compactionThresholdRatio,
    keepRecentRuns: configured?.keepRecentRuns
      ?? defaults?.keepRecentRuns
      ?? DEFAULT_CONTEXT_POLICY.keepRecentRuns,
  };
  validateContextPolicy(policy);
  return policy;
}

export function validateContextPolicy(policy: ContextPolicy): void {
  if (
    !Number.isFinite(policy.compactionThresholdRatio)
    || policy.compactionThresholdRatio <= 0
    || policy.compactionThresholdRatio >= 1
  ) {
    throw new RangeError('compactionThresholdRatio must be greater than 0 and less than 1.');
  }
  if (!Number.isInteger(policy.keepRecentRuns) || policy.keepRecentRuns < 0) {
    throw new RangeError('keepRecentRuns must be a nonnegative integer.');
  }
}
