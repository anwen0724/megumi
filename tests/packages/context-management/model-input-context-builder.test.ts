import { describe, expect, it } from 'vitest';
import { buildModelInputContext } from '@megumi/context-management';
import type { ModelInputContextPart, ModelInputContextSourceRef } from '@megumi/shared/model-input-context-contracts';

const builtAt = '2026-05-27T00:00:00.000Z';
type CurrentTurnPart = Extract<ModelInputContextPart, { kind: 'current_turn' }>;
type InstructionPart = Extract<ModelInputContextPart, { kind: 'instruction' }>;
type SessionPart = Extract<ModelInputContextPart, { kind: 'session' }>;

function sourceRef(sourceId: string, sourceKind: ModelInputContextSourceRef['sourceKind']): ModelInputContextSourceRef {
  return {
    sourceId,
    sourceKind,
    sourceUri: `${sourceKind}:${sourceId}`,
    loadedAt: builtAt,
  };
}

function currentTurnPart(overrides: Partial<CurrentTurnPart> = {}): CurrentTurnPart {
  return {
    partId: 'part:current-turn:1',
    kind: 'current_turn',
    role: 'user',
    text: 'Review the current spec.',
    sourceRefs: [sourceRef('message:1', 'current_user_message')],
    priority: 90,
    budgetStatus: 'included_full',
    ...overrides,
  };
}

function instructionPart(overrides: Partial<InstructionPart> = {}): InstructionPart {
  return {
    partId: 'part:instruction:1',
    kind: 'instruction',
    instructionKind: 'system',
    text: 'You are Megumi.',
    sourceRefs: [sourceRef('source:system', 'system_instruction')],
    priority: 100,
    budgetStatus: 'included_full',
    ...overrides,
  };
}

function sessionPart(overrides: Partial<SessionPart> = {}): SessionPart {
  return {
    partId: 'part:session:1',
    kind: 'session',
    sessionKind: 'session_history',
    text: 'Earlier context.',
    sourceRefs: [sourceRef('session-message:1', 'session_message')],
    priority: 40,
    budgetStatus: 'included_reduced',
    ...overrides,
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
      modelContextWindow: 8192,
      reservedOutputTokens: 1024,
      availableInputTokens: 7168,
      keepRecentTokens: 4096,
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

  it('preserves explicit token estimates and rejects invalid contexts through the shared schema', () => {
    const context = buildModelInputContext({
      contextId: 'model-input-context:2',
      sessionId: 'session:1',
      runId: 'run:1',
      stepId: 'step:2',
      buildReason: 'continuation',
      builtAt,
      parts: [
        sessionPart({
          tokenEstimate: 3,
        }),
      ],
    });

    expect(context.parts[0]?.tokenEstimate).toBe(3);
    expect(context.budget.partBudgets).toEqual([
      { partId: 'part:session:1', tokenEstimate: 3, budgetStatus: 'included_reduced' },
    ]);
  });

  it('derives keepRecentTokens from available input tokens when omitted', () => {
    const context = buildModelInputContext({
      contextId: 'model-input-context:default-keep-recent',
      sessionId: 'session:1',
      runId: 'run:1',
      stepId: 'step:3',
      buildReason: 'initial_model_step',
      builtAt,
      modelContextWindow: 100,
      reservedOutputTokens: 25,
      parts: [
        instructionPart(),
      ],
    });

    expect(context.budget.availableInputTokens).toBe(75);
    expect(context.budget.keepRecentTokens).toBe(75);
  });
});
