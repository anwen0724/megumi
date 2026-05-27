import { describe, expect, it } from 'vitest';
import {
  MODEL_INPUT_CONTEXT_BUDGET_STATUSES,
  MODEL_INPUT_CONTEXT_PART_KINDS,
  MODEL_INPUT_CONTEXT_SOURCE_KINDS,
  ModelInputContextSchema,
  type ModelInputContext,
} from '@megumi/shared/model-input-context-contracts';

const builtAt = '2026-05-27T00:00:00.000Z';

function sourceRef(sourceId: string, sourceKind: ModelInputContext['parts'][number]['sourceRefs'][number]['sourceKind']) {
  return {
    sourceId,
    sourceKind,
    sourceUri: `${sourceKind}:${sourceId}`,
    loadedAt: builtAt,
    metadata: { fixture: true },
  };
}

describe('ModelInputContext contracts', () => {
  it('parses strict provider-neutral model input context parts with source refs and budget status', () => {
    const parsed = ModelInputContextSchema.parse({
      contextId: 'model-input-context:1',
      sessionId: 'session:1',
      runId: 'run:1',
      stepId: 'step:1',
      parts: [
        {
          partId: 'part:instruction:1',
          kind: 'instruction',
          instructionKind: 'system',
          text: 'You are Megumi.',
          sourceRefs: [sourceRef('source:system', 'system_instruction')],
          priority: 100,
          tokenEstimate: 4,
          budgetStatus: 'included_full',
        },
        {
          partId: 'part:current-turn:1',
          kind: 'current_turn',
          role: 'user',
          text: 'Review this project.',
          sourceRefs: [sourceRef('message:1', 'current_user_message')],
          priority: 90,
          tokenEstimate: 5,
          budgetStatus: 'included_full',
        },
        {
          partId: 'part:session:1',
          kind: 'session',
          text: 'Earlier, the user confirmed the spec order.',
          sourceRefs: [sourceRef('timeline-message:1', 'timeline_message')],
          priority: 50,
          tokenEstimate: 10,
          budgetStatus: 'included_reduced',
        },
        {
          partId: 'part:tool:1',
          kind: 'tool_continuation',
          text: 'read_file returned package metadata.',
          sourceRefs: [sourceRef('tool-result:1', 'tool_result')],
          priority: 80,
          tokenEstimate: 8,
          budgetStatus: 'included_full',
          toolUseId: 'tool-use:1',
          toolResultId: 'tool-result:1',
        },
        {
          partId: 'part:runtime:1',
          kind: 'runtime_constraint',
          constraintKind: 'permission_mode',
          text: 'Permission mode is default.',
          sourceRefs: [sourceRef('permission-mode:1', 'permission_mode')],
          priority: 70,
          tokenEstimate: 6,
          budgetStatus: 'included_full',
        },
      ],
      budget: {
        modelContextWindow: 8192,
        reservedOutputTokens: 1024,
        availableInputTokens: 7168,
        inputTokenEstimate: 33,
        partBudgets: [
          { partId: 'part:instruction:1', tokenEstimate: 4, budgetStatus: 'included_full' },
          { partId: 'part:current-turn:1', tokenEstimate: 5, budgetStatus: 'included_full' },
          { partId: 'part:session:1', tokenEstimate: 10, budgetStatus: 'included_reduced' },
          { partId: 'part:tool:1', tokenEstimate: 8, budgetStatus: 'included_full' },
          { partId: 'part:runtime:1', tokenEstimate: 6, budgetStatus: 'included_full' },
        ],
      },
      trace: {
        buildReason: 'initial_model_step',
        selectedSources: [
          { sourceId: 'source:system', reason: 'system_instruction' },
          { sourceId: 'message:1', reason: 'current_turn' },
        ],
        excludedSources: [
          {
            sourceRef: sourceRef('timeline-message:old', 'timeline_message'),
            reason: 'outside_recent_window',
          },
        ],
      },
      builtAt,
    });

    expect(parsed.parts.map((part) => part.kind)).toEqual([
      'instruction',
      'current_turn',
      'session',
      'tool_continuation',
      'runtime_constraint',
    ]);
    expect(parsed.parts[0]?.sourceRefs[0]?.sourceKind).toBe('system_instruction');
    expect(parsed.parts[2]?.budgetStatus).toBe('included_reduced');
    expect(parsed.trace.excludedSources[0]?.reason).toBe('outside_recent_window');
    expect(JSON.stringify(parsed)).not.toContain('sk-test');
  });

  it('rejects parts without source refs and rejects unknown fields', () => {
    expect(() => ModelInputContextSchema.parse({
      contextId: 'model-input-context:1',
      sessionId: 'session:1',
      runId: 'run:1',
      stepId: 'step:1',
      parts: [{
        partId: 'part:1',
        kind: 'instruction',
        instructionKind: 'system',
        text: 'Missing source refs.',
        sourceRefs: [],
        priority: 100,
        budgetStatus: 'included_full',
      }],
      budget: {
        modelContextWindow: 8192,
        reservedOutputTokens: 1024,
        availableInputTokens: 7168,
        inputTokenEstimate: 0,
        partBudgets: [],
      },
      trace: {
        buildReason: 'test',
        selectedSources: [],
        excludedSources: [],
      },
      builtAt,
      rawPrompt: 'must not be accepted',
    })).toThrow();
  });

  it('exports stable model input context constants', () => {
    expect(MODEL_INPUT_CONTEXT_PART_KINDS).toEqual([
      'instruction',
      'current_turn',
      'session',
      'tool_continuation',
      'runtime_constraint',
    ]);
    expect(MODEL_INPUT_CONTEXT_BUDGET_STATUSES).toEqual([
      'included_full',
      'included_truncated',
      'included_reduced',
    ]);
    expect(MODEL_INPUT_CONTEXT_SOURCE_KINDS).toContain('project_instruction');
    expect(MODEL_INPUT_CONTEXT_SOURCE_KINDS).toContain('tool_result');
  });
});
