import { describe, expect, it } from 'vitest';
import { buildModelInputContext } from '@megumi/coding-agent/context';
import type { ModelInputContextSourceRef } from '@megumi/shared/model';
import type { ModelInputContextPartDraft } from '@megumi/coding-agent/context/context-budget';

const builtAt = '2026-05-27T00:00:00.000Z';
type CurrentTurnDraft = Extract<ModelInputContextPartDraft, { kind: 'current_turn' }>;
type InstructionDraft = Extract<ModelInputContextPartDraft, { kind: 'instruction' }>;
type SessionDraft = Extract<ModelInputContextPartDraft, { kind: 'session' }>;

function sourceRef(sourceId: string, sourceKind: ModelInputContextSourceRef['sourceKind']): ModelInputContextSourceRef {
  return {
    sourceId,
    sourceKind,
    sourceUri: `${sourceKind}:${sourceId}`,
    loadedAt: builtAt,
  };
}

function currentTurnPart(overrides: Partial<CurrentTurnDraft> = {}): CurrentTurnDraft {
  return {
    partId: 'part:current-turn:1',
    kind: 'current_turn',
    role: 'user',
    text: 'Review the current spec.',
    sourceRefs: [sourceRef('message:1', 'current_user_message')],
    priority: 90,
    ...overrides,
  };
}

function instructionPart(overrides: Partial<InstructionDraft> = {}): InstructionDraft {
  return {
    partId: 'part:instruction:1',
    kind: 'instruction',
    instructionKind: 'system',
    text: 'You are Megumi.',
    sourceRefs: [sourceRef('source:system', 'system_instruction')],
    priority: 100,
    ...overrides,
  };
}

function sessionPart(overrides: Partial<SessionDraft> = {}): SessionDraft {
  return {
    partId: 'part:session:1',
    kind: 'session',
    sessionKind: 'session_history',
    text: 'Earlier context.',
    sourceRefs: [sourceRef('session-message:1', 'session_message')],
    priority: 40,
    ...overrides,
  };
}

function sessionHistoryDraft(input: {
  partId: string;
  sourceId: string;
  text: string;
  loadedAt: string;
}): ModelInputContextPartDraft {
  return {
    partId: input.partId,
    kind: 'session',
    sessionKind: 'session_history',
    text: input.text,
    sourceRefs: [{
      sourceId: input.sourceId,
      sourceKind: 'session_message',
      sourceUri: `session-message://${input.sourceId}`,
      loadedAt: input.loadedAt,
    }],
    priority: 55,
  };
}

describe('ModelInputContextBuilder', () => {
  it('builds a strict model input context with budget and selected source trace', () => {
    const context = buildModelInputContext({
      contextId: 'model-input-context:1',
      sessionId: 'session:1',
      runId: 'run:1',
      stepId: 'step:1',
      buildReason: 'initial_model_step',
      builtAt,
      budgetPolicy: {
        modelContextWindow: 8192,
        reservedOutputTokens: 1024,
        keepRecentTokens: 4096,
      },
      parts: [
        instructionPart(),
        currentTurnPart(),
      ],
      excludedSources: [{
        sourceRef: sourceRef('timeline-message:old', 'timeline_message'),
        reason: 'outside_recent_window',
      }],
    });

    expect(context.contextId).toBe('model-input-context:1');
    expect(context.parts.map((item) => item.kind)).toEqual(['instruction', 'current_turn']);
    expect(context.parts[0]?.tokenEstimate).toBeGreaterThan(0);
    expect(context.budget.inputTokenEstimate).toBe(
      context.budget.partBudgets.reduce((sum, item) => sum + item.tokenEstimate, 0),
    );
    expect(context.budget.keepRecentTokens).toBe(4096);
    expect(context.trace.selectedSources.map((source) => source.sourceId)).toEqual([
      'source:system',
      'message:1',
    ]);
    expect(context.trace.excludedSources[0]?.reason).toBe('outside_recent_window');
    expect(JSON.stringify(context)).not.toContain('raw full prompt');
  });

  it('computes token estimates and final budget status through the budget executor', () => {
    const context = buildModelInputContext({
      contextId: 'model-input-context:2',
      sessionId: 'session:1',
      runId: 'run:1',
      stepId: 'step:2',
      buildReason: 'continuation',
      builtAt,
      parts: [
        sessionPart(),
      ],
    });

    expect(context.parts[0]?.tokenEstimate).toBeGreaterThan(0);
    expect(context.budget.partBudgets).toEqual([
      {
        partId: 'part:session:1',
        tokenEstimate: context.parts[0]?.tokenEstimate,
        budgetStatus: 'included_full',
      },
    ]);
  });

  it('uses the default context budget policy when no policy is provided', () => {
    const context = buildModelInputContext({
      contextId: 'model-input-context:default-budget-policy',
      sessionId: 'session:1',
      runId: 'run:1',
      stepId: 'step:3',
      buildReason: 'initial_model_step',
      builtAt,
      parts: [
        instructionPart(),
      ],
    });

    expect(context.budget.modelContextWindow).toBe(8192);
    expect(context.budget.reservedOutputTokens).toBe(1024);
    expect(context.budget.availableInputTokens).toBe(7168);
    expect(context.budget.keepRecentTokens).toBe(7168);
  });

  it('rejects loose budget input fields at compile time', () => {
    buildModelInputContext({
      contextId: 'model-input-context:loose-budget-fields',
      sessionId: 'session:1',
      runId: 'run:1',
      stepId: 'step:4',
      buildReason: 'initial_model_step',
      builtAt,
      parts: [
        instructionPart(),
      ],
      // @ts-expect-error loose budget fields must not be accepted by the builder API
      availableInputTokens: 7168,
    });
  });

  it('applies context budget to draft parts before building the final context', () => {
    const context = buildModelInputContext({
      contextId: 'model-input-context:builder-budget',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      buildReason: 'unit-test',
      builtAt: '2026-05-30T00:00:00.000Z',
      budgetPolicy: {
        modelContextWindow: 80,
        reservedOutputTokens: 20,
        keepRecentTokens: 20,
      },
      parts: [
        sessionHistoryDraft({
          partId: 'part:session-history:old',
          sourceId: 'session-message:old',
          text: 'old '.repeat(80),
          loadedAt: '2026-05-30T00:00:00.000Z',
        }),
        sessionHistoryDraft({
          partId: 'part:session-history:new',
          sourceId: 'session-message:new',
          text: 'new reply',
          loadedAt: '2026-05-30T00:01:00.000Z',
        }),
      ],
    });

    expect(context.parts.map((part) => part.partId)).toEqual(['part:session-history:new']);
    expect(context.trace.excludedSources).toContainEqual(expect.objectContaining({
      reason: 'outside_keep_recent_tokens',
    }));
    expect(context.trace.firstKeptPartId).toBe('part:session-history:new');
    expect(context.budget.keepRecentTokens).toBe(20);
  });

  it('turns source truncation hints into final truncated budget status', () => {
    const context = buildModelInputContext({
      contextId: 'model-input-context:builder-truncation',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      buildReason: 'unit-test',
      builtAt: '2026-05-30T00:00:00.000Z',
      budgetPolicy: {
        modelContextWindow: 8192,
        reservedOutputTokens: 1024,
        keepRecentTokens: 4096,
      },
      parts: [{
        partId: 'part:instruction:project:root',
        kind: 'instruction',
        instructionKind: 'project',
        text: 'Follow these agent instructions:\n\nUse the repo rules.',
        sourceRefs: [{
          sourceId: 'agent-instruction:root',
          sourceKind: 'project_instruction',
          sourceUri: 'file:///repo/AGENTS.md',
          loadedAt: '2026-05-30T00:00:00.000Z',
        }],
        priority: 100,
        truncationHint: {
          reason: 'project_instruction_hard_cap_exceeded',
        },
      }],
    });

    expect(context.parts[0]).toMatchObject({
      budgetStatus: 'included_truncated',
      truncation: {
        reason: 'project_instruction_hard_cap_exceeded',
      },
    });
    expect(context.trace.selectedSources[0]).toMatchObject({
      sourceId: 'agent-instruction:root',
      reason: 'project_instruction_hard_cap_exceeded',
    });
  });
});
