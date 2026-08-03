/*
 * Owns transient Context token estimation and the Usage facts derived from
 * Session History. Session History is the only authoritative Usage source;
 * no Snapshot, Recorder or second Usage state exists here.
 */

import type { Api, Model } from '@megumi/ai';
import {
  calculateContextTokens,
  estimateContextTokens,
  type ContextUsageEstimate,
} from '@megumi/ai';
import type { SessionHistoryItem } from '@megumi/session';
import type { Message } from '@megumi/ai';
import { sessionMessagesToEstimateMessages } from './context-messages';

export type { ContextUsageEstimate };

export function calculatePromptTokens(usage: { input: number; cacheRead: number; cacheWrite: number }): number {
  return usage.input + usage.cacheRead + usage.cacheWrite;
}

export { calculateContextTokens, estimateContextTokens };

export interface DerivedContextUsage {
  readonly usageTokens: number;
  readonly trailingTokens: number;
  readonly totalTokens: number;
  readonly contextWindowTokens: number;
  readonly usedRatio: number;
  readonly cumulativeInputTokens: number;
  readonly cumulativeOutputTokens: number;
  readonly cumulativeCost: number;
  readonly accuracy: 'provider_reported' | 'estimated';
}

/**
 * Derives the current Session usage from Session History and the selected Model.
 * It never triggers a Context build and never pretends to be the next ModelCall's
 * exact Prompt budget.
 */
export function deriveContextUsage(input: {
  readonly history: readonly SessionHistoryItem[];
  readonly model: Model<Api>;
}): DerivedContextUsage {
  const messages = sessionMessagesToEstimateMessages(input.history);
  const estimate = estimateContextTokens(messages);
  let cumulativeInputTokens = 0;
  let cumulativeOutputTokens = 0;
  let cumulativeCost = 0;
  for (const item of input.history) {
    if (item.type !== 'message') continue;
    const usage = item.message.message_kind === 'model_response' || item.message.message_kind === 'assistant_reply'
      ? item.message.usage
      : item.message.message_kind === 'tool_result' ? item.message.usage : undefined;
    if (!usage) continue;
    cumulativeInputTokens += usage.input + usage.cacheRead + usage.cacheWrite;
    cumulativeOutputTokens += usage.output;
    cumulativeCost += usage.cost.total;
  }
  const usageTokens = estimate.usageTokens > 0 ? estimate.usageTokens : estimate.tokens;
  return {
    usageTokens,
    trailingTokens: estimate.trailingTokens,
    totalTokens: estimate.tokens,
    contextWindowTokens: input.model.contextWindow,
    usedRatio: estimate.tokens / input.model.contextWindow,
    cumulativeInputTokens,
    cumulativeOutputTokens,
    cumulativeCost,
    accuracy: estimate.usageTokens > 0 ? 'provider_reported' : 'estimated',
  };
}

export type { Message };
