/*
 * Plans one rolling compaction attempt from measured complete-Turn prompt usage.
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
  previousSummaryInputTokens: number;
  nonCompressibleInputTokens: number;
  historicalTurns: ConversationTurn[];
  historicalTurnInputTokens: number[];
  thresholdInputTokens: number;
  currentTurn?: CurrentConversationTurn;
};

export type PlanCompactionResult =
  | { status: 'planned'; plan: CompactionPlan }
  | {
      status: 'nothing_to_compact';
      reason: 'no_complete_turns' | 'no_reducible_prefix';
    };

export function planCompaction(request: PlanCompactionRequest): PlanCompactionResult {
  validateRequest(request);
  if (request.historicalTurns.length === 0) {
    return { status: 'nothing_to_compact', reason: 'no_complete_turns' };
  }

  const historicalInputTokens = sum(request.historicalTurnInputTokens);
  const usageBeforeInputTokens = request.nonCompressibleInputTokens
    + request.previousSummaryInputTokens
    + historicalInputTokens;
  let retainedTurnInputTokens = historicalInputTokens;
  let largestReduciblePrefixLength = 0;

  for (let index = 0; index < request.historicalTurns.length; index += 1) {
    retainedTurnInputTokens -= request.historicalTurnInputTokens[index];
    // The active prior Summary remains in every planning projection. The
    // generated replacement is validated against actual complete usage later;
    // planning does not invent a fixed compression ratio for unknown output.
    const projectedInputTokens = request.nonCompressibleInputTokens
      + request.previousSummaryInputTokens
      + retainedTurnInputTokens;

    if (projectedInputTokens >= usageBeforeInputTokens) continue;
    largestReduciblePrefixLength = index + 1;
    if (projectedInputTokens < request.thresholdInputTokens) {
      return plannedPrefix(request, index + 1);
    }
  }

  return largestReduciblePrefixLength > 0
    ? plannedPrefix(request, largestReduciblePrefixLength)
    : { status: 'nothing_to_compact', reason: 'no_reducible_prefix' };
}

export type ValidateCompactionReductionRequest = {
  usageBeforeInputTokens: number;
  usageAfterInputTokens: number;
  thresholdInputTokens: number;
};

export type ValidateCompactionReductionResult =
  | { status: 'valid' }
  | { status: 'nothing_to_compact'; reason: 'summary_not_reducing' };

export function validateCompactionReduction(
  request: ValidateCompactionReductionRequest,
): ValidateCompactionReductionResult {
  validateTokenCount(request.usageBeforeInputTokens, 'usageBeforeInputTokens');
  validateTokenCount(request.usageAfterInputTokens, 'usageAfterInputTokens');
  validateTokenCount(request.thresholdInputTokens, 'thresholdInputTokens');

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
      coveredUntilEntryId: lastCoveredTurn.source.assistantEntryId,
      ...(firstKeptEntryId ? { firstKeptEntryId } : {}),
    },
  };
}

function validateRequest(request: PlanCompactionRequest): void {
  validateTokenCount(request.previousSummaryInputTokens, 'previousSummaryInputTokens');
  validateTokenCount(request.nonCompressibleInputTokens, 'nonCompressibleInputTokens');
  validateTokenCount(request.thresholdInputTokens, 'thresholdInputTokens');

  if (request.historicalTurnInputTokens.length !== request.historicalTurns.length) {
    throw new RangeError('Compaction usage arrays must align with historicalTurns.');
  }

  request.historicalTurnInputTokens.forEach((tokens, index) => {
    validateTokenCount(tokens, `historicalTurnInputTokens[${index}]`);
  });
}

function validateTokenCount(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a nonnegative integer.`);
  }
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
