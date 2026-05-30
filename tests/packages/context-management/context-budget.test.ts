import { describe, expect, it } from 'vitest';
import {
  applyContextBudget,
  estimateModelInputContextTokens,
  type ModelInputContextPartDraft,
} from '@megumi/context-management';
import type { ModelInputContextSourceRef } from '@megumi/shared/model-input-context-contracts';

const builtAt = '2026-05-30T00:00:00.000Z';

function textForTokens(tokens: number): string {
  return 'x'.repeat(tokens * 4);
}

function sourceRef(sourceId: string, sourceKind: ModelInputContextSourceRef['sourceKind'], loadedAt = builtAt): ModelInputContextSourceRef {
  return {
    sourceId,
    sourceKind,
    sourceUri: `${sourceKind}:${sourceId}`,
    loadedAt,
  };
}

function instructionPart(tokens: number, sourceId = 'instruction:1'): ModelInputContextPartDraft {
  return {
    partId: `part:${sourceId}`,
    kind: 'instruction',
    instructionKind: 'project',
    text: textForTokens(tokens),
    sourceRefs: [sourceRef(sourceId, 'project_instruction')],
    priority: 100,
  };
}

function currentTurnPart(tokens: number, sourceId = 'current:1'): ModelInputContextPartDraft {
  return {
    partId: `part:${sourceId}`,
    kind: 'current_turn',
    role: 'user',
    text: textForTokens(tokens),
    sourceRefs: [sourceRef(sourceId, 'current_user_message')],
    priority: 95,
  };
}

function sessionHistoryPart(tokens: number, sourceId: string, loadedAt: string): ModelInputContextPartDraft {
  return {
    partId: `part:${sourceId}`,
    kind: 'session',
    sessionKind: 'session_history',
    text: textForTokens(tokens),
    sourceRefs: [sourceRef(sourceId, 'session_message', loadedAt)],
    priority: 50,
  };
}

function runtimeFactPart(
  tokens: number,
  sourceId: string,
  severity: 'info' | 'warning' | 'error',
  loadedAt: string,
): ModelInputContextPartDraft {
  return {
    partId: `part:${sourceId}`,
    kind: 'session',
    sessionKind: 'session_runtime_fact',
    text: textForTokens(tokens),
    sourceRefs: [sourceRef(sourceId, 'session_runtime_fact', loadedAt)],
    priority: severity === 'error' ? 80 : severity === 'warning' ? 70 : 60,
    metadata: {
      severity,
    },
  };
}

function toolContinuationPart(tokens: number, sourceId: string, toolUseId: string): ModelInputContextPartDraft {
  return {
    partId: `part:${sourceId}`,
    kind: 'tool_continuation',
    text: textForTokens(tokens),
    toolUseId,
    sourceRefs: [sourceRef(sourceId, sourceId.startsWith('tool-result') ? 'tool_result' : 'tool_use')],
    priority: 85,
    retentionGroupId: `tool:${toolUseId}`,
  };
}

describe('Context budget executor', () => {
  it('estimates model input tokens with the V1 character heuristic', () => {
    expect(estimateModelInputContextTokens('')).toBe(0);
    expect(estimateModelInputContextTokens('x')).toBe(1);
    expect(estimateModelInputContextTokens('abcd')).toBe(1);
    expect(estimateModelInputContextTokens('abcde')).toBe(2);
  });

  it('includes all parts when total estimate fits the input budget', () => {
    const result = applyContextBudget({
      buildReason: 'initial_model_step',
      policy: {
        modelContextWindow: 100,
        reservedOutputTokens: 20,
        keepRecentTokens: 30,
      },
      parts: [
        instructionPart(5),
        sessionHistoryPart(10, 'history:1', '2026-05-30T00:00:01.000Z'),
        currentTurnPart(5),
      ],
    });

    expect(result.parts.map((part) => part.partId)).toEqual([
      'part:instruction:1',
      'part:history:1',
      'part:current:1',
    ]);
    expect(result.budget).toMatchObject({
      modelContextWindow: 100,
      reservedOutputTokens: 20,
      availableInputTokens: 80,
      keepRecentTokens: 30,
      inputTokenEstimate: 20,
    });
    expect(result.parts.map((part) => part.budgetStatus)).toEqual([
      'included_full',
      'included_full',
      'included_full',
    ]);
    expect(result.trace.selectedSources.map((source) => source.sourceId)).toEqual([
      'instruction:1',
      'history:1',
      'current:1',
    ]);
    expect(result.trace.excludedSources).toEqual([]);
    expect(result.trace.budgetWarnings).toBeUndefined();
  });

  it('includes all session history when total estimate fits even if history exceeds keepRecentTokens', () => {
    const result = applyContextBudget({
      buildReason: 'fits_despite_keep_recent_window',
      policy: {
        modelContextWindow: 100,
        reservedOutputTokens: 10,
        keepRecentTokens: 10,
      },
      parts: [
        currentTurnPart(5),
        sessionHistoryPart(10, 'history:old', '2026-05-30T00:00:01.000Z'),
        sessionHistoryPart(10, 'history:middle', '2026-05-30T00:00:02.000Z'),
        sessionHistoryPart(10, 'history:new', '2026-05-30T00:00:03.000Z'),
      ],
    });

    expect(result.parts.map((part) => part.partId)).toEqual([
      'part:current:1',
      'part:history:old',
      'part:history:middle',
      'part:history:new',
    ]);
    expect(result.budget).toMatchObject({
      availableInputTokens: 90,
      keepRecentTokens: 10,
      inputTokenEstimate: 35,
    });
    expect(result.trace.excludedSources).toEqual([]);
    expect(result.trace.firstKeptPartId).toBeUndefined();
    expect(result.trace.firstKeptSourceId).toBeUndefined();
  });

  it('counts instruction in budget statistics but never prunes it as session context', () => {
    const result = applyContextBudget({
      buildReason: 'required_over_budget',
      policy: {
        modelContextWindow: 50,
        reservedOutputTokens: 10,
        keepRecentTokens: 20,
      },
      parts: [
        instructionPart(35),
        currentTurnPart(10),
        sessionHistoryPart(5, 'history:old', '2026-05-30T00:00:01.000Z'),
      ],
    });

    expect(result.parts.map((part) => part.partId)).toEqual([
      'part:instruction:1',
      'part:current:1',
    ]);
    expect(result.budget.inputTokenEstimate).toBe(45);
    expect(result.trace.budgetWarnings).toEqual([
      {
        reason: 'required_context_over_budget',
        tokenEstimate: 45,
        availableInputTokens: 40,
      },
    ]);
    expect(result.trace.excludedSources).toEqual([
      {
        sourceRef: sourceRef('history:old', 'session_message', '2026-05-30T00:00:01.000Z'),
        reason: 'outside_keep_recent_tokens',
      },
    ]);
  });

  it('does not let required false demote kind-mandated required context', () => {
    const requiredFalseInstruction = {
      ...instructionPart(12, 'instruction:required-false'),
      required: false,
    };

    const result = applyContextBudget({
      buildReason: 'required_false_instruction',
      policy: {
        modelContextWindow: 15,
        reservedOutputTokens: 5,
        keepRecentTokens: 10,
      },
      parts: [
        requiredFalseInstruction,
        sessionHistoryPart(5, 'history:old', '2026-05-30T00:00:01.000Z'),
      ],
    });

    expect(result.parts.map((part) => part.partId)).toEqual([
      'part:instruction:required-false',
    ]);
    expect(result.trace.budgetWarnings).toEqual([
      {
        reason: 'required_context_over_budget',
        tokenEstimate: 12,
        availableInputTokens: 10,
      },
    ]);
    expect(result.trace.excludedSources).toEqual([
      {
        sourceRef: sourceRef('history:old', 'session_message', '2026-05-30T00:00:01.000Z'),
        reason: 'outside_keep_recent_tokens',
      },
    ]);
  });

  it('keeps recent session history up to keepRecentTokens and records the first kept boundary', () => {
    const result = applyContextBudget({
      buildReason: 'history_budget',
      policy: {
        modelContextWindow: 30,
        reservedOutputTokens: 5,
        keepRecentTokens: 20,
      },
      parts: [
        currentTurnPart(5),
        sessionHistoryPart(10, 'history:old', '2026-05-30T00:00:01.000Z'),
        sessionHistoryPart(10, 'history:middle', '2026-05-30T00:00:02.000Z'),
        sessionHistoryPart(10, 'history:new', '2026-05-30T00:00:03.000Z'),
      ],
    });

    expect(result.parts.map((part) => part.partId)).toEqual([
      'part:current:1',
      'part:history:middle',
      'part:history:new',
    ]);
    expect(result.trace.excludedSources).toEqual([
      {
        sourceRef: sourceRef('history:old', 'session_message', '2026-05-30T00:00:01.000Z'),
        reason: 'outside_keep_recent_tokens',
      },
    ]);
    expect(result.trace.firstKeptPartId).toBe('part:history:middle');
    expect(result.trace.firstKeptSourceId).toBe('history:middle');
  });

  it('keeps a contiguous recent session history suffix when an oversized middle part exceeds budget', () => {
    const result = applyContextBudget({
      buildReason: 'history_contiguous_suffix',
      policy: {
        modelContextWindow: 20,
        reservedOutputTokens: 5,
        keepRecentTokens: 10,
      },
      parts: [
        currentTurnPart(1),
        sessionHistoryPart(5, 'history:old', '2026-05-30T00:00:01.000Z'),
        sessionHistoryPart(50, 'history:middle', '2026-05-30T00:00:02.000Z'),
        sessionHistoryPart(5, 'history:new', '2026-05-30T00:00:03.000Z'),
      ],
    });

    expect(result.parts.map((part) => part.partId)).toEqual([
      'part:current:1',
      'part:history:new',
    ]);
    expect(result.trace.excludedSources).toEqual([
      {
        sourceRef: sourceRef('history:old', 'session_message', '2026-05-30T00:00:01.000Z'),
        reason: 'outside_keep_recent_tokens',
      },
      {
        sourceRef: sourceRef('history:middle', 'session_message', '2026-05-30T00:00:02.000Z'),
        reason: 'outside_keep_recent_tokens',
      },
    ]);
    expect(result.trace.firstKeptPartId).toBe('part:history:new');
    expect(result.trace.firstKeptSourceId).toBe('history:new');
  });

  it('prunes runtime facts by severity and recency after required context', () => {
    const result = applyContextBudget({
      buildReason: 'runtime_fact_budget',
      policy: {
        modelContextWindow: 35,
        reservedOutputTokens: 5,
        keepRecentTokens: 20,
      },
      parts: [
        currentTurnPart(5),
        runtimeFactPart(10, 'fact:old-info', 'info', '2026-05-30T00:00:01.000Z'),
        runtimeFactPart(10, 'fact:new-warning', 'warning', '2026-05-30T00:00:03.000Z'),
        runtimeFactPart(10, 'fact:old-error', 'error', '2026-05-30T00:00:02.000Z'),
      ],
    });

    expect(result.parts.map((part) => part.partId)).toEqual([
      'part:current:1',
      'part:fact:new-warning',
      'part:fact:old-error',
    ]);
    expect(result.trace.excludedSources).toEqual([
      {
        sourceRef: sourceRef('fact:old-info', 'session_runtime_fact', '2026-05-30T00:00:01.000Z'),
        reason: 'context_budget_exceeded',
      },
    ]);
  });

  it('preserves source-specific truncation hints without treating them as budget pruning', () => {
    const result = applyContextBudget({
      buildReason: 'instruction_hard_cap',
      policy: {
        modelContextWindow: 100,
        reservedOutputTokens: 10,
        keepRecentTokens: 20,
      },
      parts: [
        {
          partId: 'part:instruction:truncated',
          kind: 'instruction',
          instructionKind: 'project',
          text: textForTokens(10),
          sourceRefs: [sourceRef('instruction:truncated', 'project_instruction')],
          priority: 100,
          truncationHint: {
            reason: 'project_instruction_hard_cap_exceeded',
          },
        },
      ],
    });

    expect(result.parts[0]).toMatchObject({
      budgetStatus: 'included_truncated',
      truncation: {
        reason: 'project_instruction_hard_cap_exceeded',
      },
    });
    expect(result.trace.selectedSources).toEqual([
      {
        sourceId: 'instruction:truncated',
        reason: 'project_instruction_hard_cap_exceeded',
      },
    ]);
  });

  it('keeps tool continuation parts together as required context', () => {
    const result = applyContextBudget({
      buildReason: 'tool_continuation',
      policy: {
        modelContextWindow: 35,
        reservedOutputTokens: 5,
        keepRecentTokens: 10,
      },
      parts: [
        toolContinuationPart(20, 'tool-use:1', 'tool:1'),
        toolContinuationPart(20, 'tool-result:1', 'tool:1'),
        sessionHistoryPart(5, 'history:old', '2026-05-30T00:00:01.000Z'),
      ],
    });

    expect(result.parts.map((part) => part.partId)).toEqual([
      'part:tool-use:1',
      'part:tool-result:1',
    ]);
    expect(result.trace.budgetWarnings).toEqual([
      {
        reason: 'required_context_over_budget',
        tokenEstimate: 40,
        availableInputTokens: 30,
      },
    ]);
  });
});
