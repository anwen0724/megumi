import type { ContextBudgetPolicy, ContextBudgetWarning } from '@megumi/shared/context-budget-contracts';
import type {
  CurrentTurnPart,
  InstructionPart,
  ModelInputContextBudget,
  ModelInputContextBudgetStatus,
  ModelInputContextExcludedSource,
  ModelInputContextPart,
  ModelInputContextPartBudget,
  ModelInputContextSelectedSource,
  ModelInputContextTrace,
  ModelInputContextTruncation,
  RuntimeConstraintPart,
  SessionPart,
  ToolContinuationPart,
} from '@megumi/shared/model-input-context-contracts';

type DraftFields = {
  truncationHint?: ModelInputContextTruncation;
  required?: boolean;
  retentionGroupId?: string;
};

type BudgetlessPart<T extends ModelInputContextPart> = Omit<T, 'tokenEstimate' | 'budgetStatus' | 'truncation'>;

export type ModelInputContextPartDraft =
  | (BudgetlessPart<InstructionPart> & DraftFields)
  | (BudgetlessPart<CurrentTurnPart> & DraftFields)
  | (BudgetlessPart<SessionPart> & DraftFields)
  | (BudgetlessPart<ToolContinuationPart> & DraftFields)
  | (BudgetlessPart<RuntimeConstraintPart> & DraftFields);

export interface ApplyContextBudgetInput {
  parts: ModelInputContextPartDraft[];
  policy: ContextBudgetPolicy;
  buildReason: string;
  preExcludedSources?: ModelInputContextExcludedSource[];
}

export interface ApplyContextBudgetResult {
  parts: ModelInputContextPart[];
  budget: ModelInputContextBudget;
  trace: ModelInputContextTrace;
}

interface EstimatedDraft {
  draft: ModelInputContextPartDraft;
  index: number;
  tokenEstimate: number;
  required: boolean;
}

const SESSION_HISTORY_EXCLUDED_REASON = 'outside_keep_recent_tokens';
const CONTEXT_BUDGET_EXCEEDED_REASON = 'context_budget_exceeded';

export function applyContextBudget(input: ApplyContextBudgetInput): ApplyContextBudgetResult {
  const availableInputTokens = Math.max(0, input.policy.modelContextWindow - input.policy.reservedOutputTokens);
  const estimatedParts = input.parts.map((draft, index): EstimatedDraft => ({
    draft,
    index,
    tokenEstimate: estimateModelInputContextTokens(textForDraft(draft)),
    required: isRequiredDraft(draft),
  }));

  const requiredParts = estimatedParts.filter((part) => part.required);
  const requiredTokenEstimate = sumTokens(requiredParts);
  const keepIndexes = new Set(requiredParts.map((part) => part.index));
  const excludedSources: ModelInputContextExcludedSource[] = [...(input.preExcludedSources ?? [])];
  const budgetWarnings: ContextBudgetWarning[] = [];

  let firstKeptPartId: string | undefined;
  let firstKeptSourceId: string | undefined;

  if (requiredTokenEstimate > availableInputTokens) {
    budgetWarnings.push({
      reason: 'required_context_over_budget',
      tokenEstimate: requiredTokenEstimate,
      availableInputTokens,
    });
    excludePrunableParts(estimatedParts, excludedSources);
  } else {
    const remainingBudget = availableInputTokens - requiredTokenEstimate;
    const historyBudget = Math.min(input.policy.keepRecentTokens, remainingBudget);
    const historySelection = selectRecentSessionHistory(estimatedParts, historyBudget);

    for (const part of historySelection.kept) {
      keepIndexes.add(part.index);
    }
    for (const part of historySelection.excluded) {
      pushExcludedSources(part.draft, SESSION_HISTORY_EXCLUDED_REASON, excludedSources);
    }

    if (historySelection.excluded.length > 0 && historySelection.kept.length > 0) {
      const firstKept = [...historySelection.kept].sort((left, right) => left.index - right.index)[0];
      firstKeptPartId = firstKept.draft.partId;
      firstKeptSourceId = firstKept.draft.sourceRefs[0]?.sourceId;
    }

    const usedByHistory = sumTokens(historySelection.kept);
    const remainingAfterHistory = Math.max(0, remainingBudget - usedByHistory);
    const runtimeSelection = selectRuntimeFacts(estimatedParts, remainingAfterHistory);

    for (const part of runtimeSelection.kept) {
      keepIndexes.add(part.index);
    }
    for (const part of runtimeSelection.excluded) {
      pushExcludedSources(part.draft, CONTEXT_BUDGET_EXCEEDED_REASON, excludedSources);
    }
  }

  const finalParts = estimatedParts
    .filter((part) => keepIndexes.has(part.index))
    .sort((left, right) => left.index - right.index)
    .map((part) => finalizePart(part.draft, part.tokenEstimate));
  const partBudgets = partBudgetsFor(finalParts);
  const inputTokenEstimate = partBudgets.reduce((sum, partBudget) => sum + partBudget.tokenEstimate, 0);

  return {
    parts: finalParts,
    budget: {
      modelContextWindow: input.policy.modelContextWindow,
      reservedOutputTokens: input.policy.reservedOutputTokens,
      availableInputTokens,
      keepRecentTokens: input.policy.keepRecentTokens,
      inputTokenEstimate,
      partBudgets,
    },
    trace: {
      buildReason: input.buildReason,
      selectedSources: selectedSourcesForParts(finalParts),
      excludedSources,
      ...(firstKeptPartId ? { firstKeptPartId } : {}),
      ...(firstKeptSourceId ? { firstKeptSourceId } : {}),
      ...(budgetWarnings.length > 0 ? { budgetWarnings } : {}),
    },
  };
}

export function estimateModelInputContextTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

function isRequiredDraft(draft: ModelInputContextPartDraft): boolean {
  if (draft.required === true) {
    return true;
  }
  if (draft.kind === 'session') {
    return draft.sessionKind === 'session_summary';
  }
  return draft.kind === 'instruction'
    || draft.kind === 'current_turn'
    || draft.kind === 'runtime_constraint'
    || draft.kind === 'tool_continuation';
}

function isSessionHistoryDraft(draft: ModelInputContextPartDraft): boolean {
  return draft.kind === 'session' && draft.sessionKind === 'session_history';
}

function isRuntimeFactDraft(draft: ModelInputContextPartDraft): boolean {
  return draft.kind === 'session' && draft.sessionKind === 'session_runtime_fact';
}

function selectRecentSessionHistory(
  parts: EstimatedDraft[],
  tokenBudget: number,
): { kept: EstimatedDraft[]; excluded: EstimatedDraft[] } {
  const historyParts = parts.filter((part) => !part.required && isSessionHistoryDraft(part.draft));
  const kept = new Set<number>();
  let usedTokens = 0;

  for (const part of [...historyParts].sort((left, right) => right.index - left.index)) {
    if (usedTokens + part.tokenEstimate <= tokenBudget) {
      kept.add(part.index);
      usedTokens += part.tokenEstimate;
    }
  }

  return {
    kept: historyParts.filter((part) => kept.has(part.index)),
    excluded: historyParts.filter((part) => !kept.has(part.index)),
  };
}

function selectRuntimeFacts(
  parts: EstimatedDraft[],
  tokenBudget: number,
): { kept: EstimatedDraft[]; excluded: EstimatedDraft[] } {
  const runtimeFacts = parts.filter((part) => !part.required && isRuntimeFactDraft(part.draft));
  const kept = new Set<number>();
  let usedTokens = 0;

  for (const part of [...runtimeFacts].sort(compareRuntimeFactsForRetention)) {
    if (usedTokens + part.tokenEstimate <= tokenBudget) {
      kept.add(part.index);
      usedTokens += part.tokenEstimate;
    }
  }

  return {
    kept: runtimeFacts.filter((part) => kept.has(part.index)),
    excluded: runtimeFacts.filter((part) => !kept.has(part.index)),
  };
}

function compareRuntimeFactsForRetention(left: EstimatedDraft, right: EstimatedDraft): number {
  const severityDelta = severityRank(right.draft) - severityRank(left.draft);
  if (severityDelta !== 0) {
    return severityDelta;
  }

  const loadedAtDelta = loadedAtMillis(right.draft) - loadedAtMillis(left.draft);
  if (loadedAtDelta !== 0) {
    return loadedAtDelta;
  }

  return right.index - left.index;
}

function severityRank(draft: ModelInputContextPartDraft): number {
  const severity = draft.metadata?.severity;
  if (severity === 'error') {
    return 3;
  }
  if (severity === 'warning') {
    return 2;
  }
  return 1;
}

function loadedAtMillis(draft: ModelInputContextPartDraft): number {
  const loadedAt = draft.sourceRefs[0]?.loadedAt;
  return loadedAt ? Date.parse(loadedAt) : 0;
}

function excludePrunableParts(
  parts: EstimatedDraft[],
  excludedSources: ModelInputContextExcludedSource[],
): void {
  for (const part of parts) {
    if (part.required) {
      continue;
    }
    if (isSessionHistoryDraft(part.draft)) {
      pushExcludedSources(part.draft, SESSION_HISTORY_EXCLUDED_REASON, excludedSources);
    } else if (isRuntimeFactDraft(part.draft)) {
      pushExcludedSources(part.draft, CONTEXT_BUDGET_EXCEEDED_REASON, excludedSources);
    }
  }
}

function pushExcludedSources(
  draft: ModelInputContextPartDraft,
  reason: string,
  excludedSources: ModelInputContextExcludedSource[],
): void {
  for (const sourceRef of draft.sourceRefs) {
    excludedSources.push({
      sourceRef,
      reason,
    });
  }
}

function finalizePart(
  draft: ModelInputContextPartDraft,
  tokenEstimate: number,
): ModelInputContextPart {
  const budgetStatus: ModelInputContextBudgetStatus = draft.truncationHint
    ? 'included_truncated'
    : 'included_full';
  const basePart = stripDraftFields(draft);

  return {
    ...basePart,
    tokenEstimate,
    budgetStatus,
    ...(draft.truncationHint ? { truncation: draft.truncationHint } : {}),
  } as ModelInputContextPart;
}

function stripDraftFields(draft: ModelInputContextPartDraft): Omit<ModelInputContextPart, 'tokenEstimate' | 'budgetStatus' | 'truncation'> {
  const clone = { ...draft } as Record<string, unknown>;
  delete clone.truncationHint;
  delete clone.required;
  delete clone.retentionGroupId;
  return clone as Omit<ModelInputContextPart, 'tokenEstimate' | 'budgetStatus' | 'truncation'>;
}

function partBudgetsFor(parts: ModelInputContextPart[]): ModelInputContextPartBudget[] {
  return parts.map((part) => ({
    partId: part.partId,
    tokenEstimate: part.tokenEstimate ?? estimateModelInputContextTokens(textForPart(part)),
    budgetStatus: part.budgetStatus,
  }));
}

function selectedSourcesForParts(parts: ModelInputContextPart[]): ModelInputContextSelectedSource[] {
  const selectedSources = new Map<string, ModelInputContextSelectedSource>();
  for (const part of parts) {
    for (const sourceRef of part.sourceRefs) {
      if (!selectedSources.has(sourceRef.sourceId)) {
        selectedSources.set(sourceRef.sourceId, {
          sourceId: sourceRef.sourceId,
          reason: selectedReasonForPart(part),
        });
      }
    }
  }
  return [...selectedSources.values()];
}

function selectedReasonForPart(part: ModelInputContextPart): string {
  if (part.truncation?.reason) {
    return part.truncation.reason;
  }
  if (part.kind === 'session') {
    return part.sessionKind;
  }
  return part.kind;
}

function sumTokens(parts: EstimatedDraft[]): number {
  return parts.reduce((sum, part) => sum + part.tokenEstimate, 0);
}

function textForDraft(draft: ModelInputContextPartDraft): string {
  return draft.text;
}

function textForPart(part: ModelInputContextPart): string {
  return part.text;
}
