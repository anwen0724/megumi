/*
 * Defines model capacity, Context policy, and complete prompt usage projections.
 */
export type ContextCapacity = {
  providerId: string;
  modelId: string;
  contextWindowTokens: number;
};

export type ContextPolicy = {
  compactionThresholdRatio: number;
  keepRecentRuns: number;
};

export type ContextUsage = {
  usedTokens: number;
  contextWindowTokens: number;
  remainingTokens: number;
  usedRatio: number;
  compactionThresholdRatio: number;
};

export type SessionUsageSnapshot = {
  sessionId: string;
  runId: string;
  providerId: string;
  modelId: string;
  usage: ContextUsage;
  accuracy: 'provider_reported' | 'estimated';
  calculatedAt: string;
};
