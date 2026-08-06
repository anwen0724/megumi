/*
 * Owns Context usage calculation: the exact next-Prompt estimate that includes
 * System Prompt, Messages and Tool Definitions, and the Session-derived display
 * usage. Session History is the only authoritative Usage source; no Snapshot,
 * Recorder or second Usage state exists here.
 */

import type { Api, Model, Usage } from '@megumi/ai';
import {
  estimateContextTokens,
  type ContextUsageEstimate,
} from '@megumi/ai/utils/estimate';
import type { SessionHistoryItem } from '@megumi/session';
import type { Prompt } from './context';
import { sessionMessagesToEstimateMessages } from './prompt/context-message-builder';

export type { ContextUsageEstimate };

export function calculatePromptTokens(usage: { input: number; cacheRead: number; cacheWrite: number }): number {
  return usage.input + usage.cacheRead + usage.cacheWrite;
}

/**
 * Calculates the complete next-ModelCall Prompt usage: System Prompt, Messages
 * and Tool Definitions all enter the result. A custom estimator receives the
 * full Prompt; the default path delegates to the AI estimator with the Prompt
 * in its accepted Context shape.
 */
export function calculatePromptUsage(input: {
  readonly prompt: Prompt;
  readonly estimator?: (prompt: Prompt) => number;
}): ContextUsageEstimate {
  const { prompt, estimator } = input;
  if (estimator) {
    const tokens = estimator(prompt);
    return { tokens, usageTokens: 0, trailingTokens: tokens, lastUsageIndex: null };
  }
  return estimateContextTokens({
    systemPrompt: prompt.systemPrompt,
    messages: [...prompt.messages],
    tools: [...prompt.tools],
  });
}

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
    let usage: Usage | undefined;
    if (item.type === 'compaction') {
      if (isUsage(item.compaction.usage)) usage = item.compaction.usage;
    } else if (item.message.message_kind === 'model_response'
      || item.message.message_kind === 'assistant_reply'
      || item.message.message_kind === 'tool_result') {
      usage = item.message.usage;
    }
    if (!usage) continue;
    cumulativeInputTokens += calculatePromptTokens(usage);
    cumulativeOutputTokens += usage.output;
    cumulativeCost += usage.cost.total;
  }
  const hasProviderUsage = estimate.usageTokens > 0;
  const usageTokens = hasProviderUsage ? estimate.usageTokens : estimate.tokens;
  return {
    usageTokens,
    trailingTokens: estimate.trailingTokens,
    totalTokens: estimate.tokens,
    contextWindowTokens: input.model.contextWindow,
    usedRatio: estimate.tokens / input.model.contextWindow,
    cumulativeInputTokens,
    cumulativeOutputTokens,
    cumulativeCost,
    accuracy: hasProviderUsage ? 'provider_reported' : 'estimated',
  };
}

function isUsage(value: unknown): value is Usage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { input?: unknown; output?: unknown; cacheRead?: unknown; cacheWrite?: unknown; cost?: unknown };
  return typeof candidate.input === 'number'
    && typeof candidate.output === 'number'
    && typeof candidate.cacheRead === 'number'
    && typeof candidate.cacheWrite === 'number'
    && typeof candidate.cost === 'object' && candidate.cost !== null;
}
