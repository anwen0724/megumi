/*
 * Plans rolling compaction by retaining a fixed number of recent complete Turns.
 */
import type {
  ConversationTurn,
  CurrentConversationTurn,
} from '../../domain/model/conversation-turn';

export type CompactionPlan = {
  turns: ConversationTurn[];
  coveredUntilEntryId: string;
  firstKeptEntryId?: string;
};

export type PlanCompactionRequest = {
  historicalTurns: ConversationTurn[];
  keepRecentTurns: number;
  currentTurn?: CurrentConversationTurn;
};

export type PlanCompactionResult =
  | { status: 'planned'; plan: CompactionPlan }
  | {
      status: 'nothing_to_compact';
      reason: 'no_historical_turns' | 'no_older_turns';
    };

export function planCompaction(request: PlanCompactionRequest): PlanCompactionResult {
  validateKeepRecentTurns(request.keepRecentTurns);
  if (request.historicalTurns.length === 0) {
    return { status: 'nothing_to_compact', reason: 'no_historical_turns' };
  }

  const prefixLength = request.historicalTurns.length - request.keepRecentTurns;
  if (prefixLength <= 0) {
    return { status: 'nothing_to_compact', reason: 'no_older_turns' };
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
  const turns = request.historicalTurns.slice(0, prefixLength);
  const lastCoveredTurn = turns[turns.length - 1];
  const firstKeptEntryId = request.historicalTurns[prefixLength]?.source.userEntryId
    ?? request.currentTurn?.userEntry.entryId;

  return {
    status: 'planned',
    plan: {
      turns,
      coveredUntilEntryId: lastCoveredTurn.source.lastEntryId,
      ...(firstKeptEntryId ? { firstKeptEntryId } : {}),
    },
  };
}

function validateKeepRecentTurns(value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError('keepRecentTurns must be a nonnegative integer.');
  }
}

function validateTokenCount(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a nonnegative integer.`);
  }
}
