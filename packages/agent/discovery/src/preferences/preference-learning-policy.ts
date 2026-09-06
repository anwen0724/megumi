/* Centralizes bounded learning defaults shared by preparation and evidence selection. */
export const PREFERENCE_LEARNING_POLICY = {
  totalTimeoutMs: 60_000,
  maximumAttempts: 3,
  retryDelayMs: 1_000,
  recentFeedbackCount: 30,
  contentCodePoints: 2_000,
  maximumInputTokens: 32_768,
  maximumOutputTokens: 4_096,
  contextBudgetRatio: 0.8,
} as const;
