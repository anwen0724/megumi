/*
 * Plans rolling compaction by retaining a fixed number of recent complete Runs.
 */
import type {
  ConversationRun,
  CurrentConversationRun,
} from '../../domain/model/conversation-run';

export type CompactionPlan = {
  runs: ConversationRun[];
  coveredUntilEntryId: string;
  firstKeptEntryId?: string;
};

export type PlanCompactionRequest = {
  historicalRuns: ConversationRun[];
  keepRecentRuns: number;
  currentRun?: CurrentConversationRun;
};

export type PlanCompactionResult =
  | { status: 'planned'; plan: CompactionPlan }
  | {
      status: 'nothing_to_compact';
      reason: 'no_historical_runs' | 'no_older_runs';
    };

export function planCompaction(request: PlanCompactionRequest): PlanCompactionResult {
  validateKeepRecentRuns(request.keepRecentRuns);
  if (request.historicalRuns.length === 0) {
    return { status: 'nothing_to_compact', reason: 'no_historical_runs' };
  }

  const prefixLength = request.historicalRuns.length - request.keepRecentRuns;
  if (prefixLength <= 0) {
    return { status: 'nothing_to_compact', reason: 'no_older_runs' };
  }

  return plannedPrefix(request, prefixLength);
}

export type ValidateCompactionReductionRequest = {
  usageBeforeInputTokens: number;
  usageAfterInputTokens: number;
};

export type ValidateCompactionReductionResult =
  | { status: 'valid' }
  | { status: 'nothing_to_compact'; reason: 'summary_not_reducing' };

export function validateCompactionReduction(
  request: ValidateCompactionReductionRequest,
): ValidateCompactionReductionResult {
  validateTokenCount(request.usageBeforeInputTokens, 'usageBeforeInputTokens');
  validateTokenCount(request.usageAfterInputTokens, 'usageAfterInputTokens');

  return request.usageAfterInputTokens < request.usageBeforeInputTokens
    ? { status: 'valid' }
    : { status: 'nothing_to_compact', reason: 'summary_not_reducing' };
}

function plannedPrefix(
  request: PlanCompactionRequest,
  prefixLength: number,
): { status: 'planned'; plan: CompactionPlan } {
  const runs = request.historicalRuns.slice(0, prefixLength);
  const lastCoveredRun = runs[runs.length - 1];
  const firstKeptEntryId = request.historicalRuns[prefixLength]?.source.userEntryId
    ?? request.currentRun?.userEntry.entryId;

  return {
    status: 'planned',
    plan: {
      runs,
      coveredUntilEntryId: lastCoveredRun.source.lastEntryId,
      ...(firstKeptEntryId ? { firstKeptEntryId } : {}),
    },
  };
}

function validateKeepRecentRuns(value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError('keepRecentRuns must be a nonnegative integer.');
  }
}

function validateTokenCount(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a nonnegative integer.`);
  }
}
