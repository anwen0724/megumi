/*
 * Calculates model input budgets, prompt estimates and existing compaction policy limits.
 */
import type { Api, Model } from '@megumi/ai';
import { estimateContextTokens, type ContextUsageEstimate } from '@megumi/ai/utils/estimate';
import type { ContextBudget, PreparedContext } from './context-contracts';

/** Reserves the selected model's output capacity before preparing its input. */
export function contextBudget(model: Model<Api>): ContextBudget {
  return { contextWindowTokens: model.contextWindow, reservedOutputTokens: model.maxTokens,
    inputTokens: model.contextWindow - model.maxTokens };
}

/* Defines the Compaction Policy and Context Window validation shared by build and compaction. */

export interface ContextCapacity {
  readonly providerId: string;
  readonly modelId: string;
  readonly contextWindowTokens: number;
}

export interface CompactionPolicy {
  readonly enabled: boolean;
  readonly reserveTokens: number;
  readonly keepRecentTokens: number;
  readonly minimumRecentMessages: number;
}

export const DEFAULT_COMPACTION_POLICY: Readonly<CompactionPolicy> = Object.freeze({
  enabled: true,
  reserveTokens: 16384,
  keepRecentTokens: 20000,
  minimumRecentMessages: 6,
});

export function contextCapacityFromModel(model: Model<Api>): ContextCapacity {
  return {
    providerId: model.provider,
    modelId: model.id,
    contextWindowTokens: model.contextWindow,
  };
}

export function resolveCompactionPolicy(
  defaults: Partial<CompactionPolicy> | undefined,
  configured: Partial<CompactionPolicy> | undefined,
): CompactionPolicy {
  const policy = {
    enabled: configured?.enabled ?? defaults?.enabled ?? DEFAULT_COMPACTION_POLICY.enabled,
    reserveTokens: configured?.reserveTokens
      ?? defaults?.reserveTokens
      ?? DEFAULT_COMPACTION_POLICY.reserveTokens,
    keepRecentTokens: configured?.keepRecentTokens
      ?? defaults?.keepRecentTokens
      ?? DEFAULT_COMPACTION_POLICY.keepRecentTokens,
    minimumRecentMessages: configured?.minimumRecentMessages
      ?? defaults?.minimumRecentMessages
      ?? DEFAULT_COMPACTION_POLICY.minimumRecentMessages,
  };
  validateCompactionPolicy(policy);
  return policy;
}

export function validateCompactionPolicy(policy: CompactionPolicy): void {
  validateTokenCount(policy.reserveTokens, 'reserveTokens');
  validateTokenCount(policy.keepRecentTokens, 'keepRecentTokens');
  validateTokenCount(policy.minimumRecentMessages, 'minimumRecentMessages');
}

export function validateTokenCount(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a nonnegative integer.`);
  }
}

/** Returns a policy failure when the configured policy cannot fit the Model Context Window. */
export function compactionPolicyFailure(
  policy: CompactionPolicy,
  capacity: ContextCapacity,
): string | undefined {
  if (policy.reserveTokens >= capacity.contextWindowTokens) {
    return `reserveTokens ${policy.reserveTokens} leaves no usable Context Window of ${capacity.contextWindowTokens} tokens.`;
  }
  return undefined;
}

/**
 * Resolves the Policy from defaults and configured values and validates it
 * against the Model Context Window without throwing on illegal Token counts.
 * build() and compact() share this single Policy entry; the caller converts
 * the invalid message into the stable policy_invalid failure.
 */
export function resolveCompactionPolicyProblem(input: {
  readonly defaults?: Partial<CompactionPolicy>;
  readonly configured?: Partial<CompactionPolicy>;
  readonly capacity: ContextCapacity;
}): { readonly status: 'ok'; readonly policy: CompactionPolicy } | { readonly status: 'invalid'; readonly message: string } {
  try {
    const policy = resolveCompactionPolicy(input.defaults, input.configured);
    const problem = compactionPolicyFailure(policy, input.capacity);
    return problem
      ? { status: 'invalid', message: problem }
      : { status: 'ok', policy };
  } catch (error) {
    return {
      status: 'invalid',
      message: error instanceof Error ? error.message : 'Compaction Policy configuration is invalid.',
    };
  }
}

/** True when the estimated full-Prompt tokens cross the automatic compaction threshold. */
export function shouldAutoCompact(input: {
  readonly policy: CompactionPolicy;
  readonly promptTokens: number;
  readonly contextWindowTokens: number;
}): boolean {
  return input.policy.enabled
    && input.promptTokens > input.contextWindowTokens - input.policy.reserveTokens;
}

/** The failure message when the final Prompt does not fit the Model Context Window. */
export function finalContextWindowProblem(input: {
  readonly promptTokens: number;
  readonly contextWindowTokens: number;
}): string | undefined {
  if (input.promptTokens >= input.contextWindowTokens) {
    return `Context uses ${input.promptTokens} tokens for a ${input.contextWindowTokens}-token Context Window.`;
  }
  return undefined;
}

export type { ContextUsageEstimate };

export function calculatePromptTokens(usage: { input: number; cacheRead: number; cacheWrite: number }): number {
  return usage.input + usage.cacheRead + usage.cacheWrite;
}

/**
 * Calculates the complete next-ModelCall PreparedContext usage: System PreparedContext, Messages
 * and Tool Definitions all enter the result. A custom estimator receives the
 * full PreparedContext; the default path delegates to the AI estimator with the PreparedContext
 * in its accepted Context shape.
 */
export function calculatePromptUsage(input: {
  readonly prompt: PreparedContext;
  readonly estimator?: (prompt: PreparedContext) => number;
}): ContextUsageEstimate {
  const { prompt, estimator } = input;
  if (estimator) {
    const tokens = estimator(prompt);
    return { tokens, usageTokens: 0, trailingTokens: tokens, lastUsageIndex: null };
  }
  // Upstream estimates transcript messages. Represent the existing prompt
  // prefix explicitly so its tokens are counted only without a usage baseline.
  const estimate = estimateContextTokens([
    {
      role: 'system',
      content: prompt.systemPrompt,
      toolsAdded: [...prompt.tools],
      timestamp: Math.min(0, ...prompt.messages.map((message) => message.timestamp)),
    },
    ...prompt.messages,
  ]);
  return {
    ...estimate,
    lastUsageIndex: estimate.lastUsageIndex === null ? null : estimate.lastUsageIndex - 1,
  };
}
