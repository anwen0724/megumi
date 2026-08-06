/* Defines the Compaction Policy and Context Window validation shared by build and compaction. */
import type { Api, Model } from '@megumi/ai';

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
