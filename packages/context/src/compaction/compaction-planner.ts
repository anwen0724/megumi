/* Calculates the compactable historical prefix without performing IO or calling a Model. */
import type { ConversationRun, CurrentConversationRun } from '../conversation-run';

export interface CompactionPlan {
  readonly runs: ConversationRun[];
  readonly coveredUntilEntryId: string;
  readonly firstKeptEntryId?: string;
}

export type PlanCompactionResult =
  | { readonly status: 'planned'; readonly plan: CompactionPlan }
  | {
      readonly status: 'nothing_to_compact';
      readonly reason: 'no_historical_runs' | 'no_older_runs';
    };

export function planCompaction(input: {
  readonly historicalRuns: ConversationRun[];
  readonly keepRecentRuns: number;
  readonly currentRun?: CurrentConversationRun;
}): PlanCompactionResult {
  if (!Number.isInteger(input.keepRecentRuns) || input.keepRecentRuns < 0) {
    throw new RangeError('keepRecentRuns must be a nonnegative integer.');
  }
  if (input.historicalRuns.length === 0) {
    return { status: 'nothing_to_compact', reason: 'no_historical_runs' };
  }
  const prefixLength = input.historicalRuns.length - input.keepRecentRuns;
  if (prefixLength <= 0) return { status: 'nothing_to_compact', reason: 'no_older_runs' };
  const runs = input.historicalRuns.slice(0, prefixLength);
  const lastCoveredRun = runs[runs.length - 1]!;
  const firstKeptEntryId = input.historicalRuns[prefixLength]?.source.userEntryId
    ?? input.currentRun?.userEntry.entryId;
  return {
    status: 'planned',
    plan: {
      runs,
      coveredUntilEntryId: lastCoveredRun.source.lastEntryId,
      ...(firstKeptEntryId ? { firstKeptEntryId } : {}),
    },
  };
}

export function validateCompactionReduction(input: {
  readonly usageBeforeInputTokens: number;
  readonly usageAfterInputTokens: number;
}): { readonly status: 'valid' } | {
  readonly status: 'nothing_to_compact';
  readonly reason: 'summary_not_reducing';
} {
  validateTokenCount(input.usageBeforeInputTokens, 'usageBeforeInputTokens');
  validateTokenCount(input.usageAfterInputTokens, 'usageAfterInputTokens');
  return input.usageAfterInputTokens < input.usageBeforeInputTokens
    ? { status: 'valid' }
    : { status: 'nothing_to_compact', reason: 'summary_not_reducing' };
}

function validateTokenCount(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a nonnegative integer.`);
  }
}
