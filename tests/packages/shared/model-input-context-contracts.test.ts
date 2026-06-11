import { describe, expect, it } from 'vitest';
import {
  AgentInstructionSourceSnapshotSchema,
  MODEL_INPUT_CONTEXT_BUDGET_STATUSES,
  MODEL_INPUT_CONTEXT_PART_KINDS,
  MODEL_INPUT_CONTEXT_SOURCE_KINDS,
  MODEL_INPUT_INSTRUCTION_KINDS,
  MODEL_INPUT_SESSION_PART_KINDS,
  ModelInputInstructionKindSchema,
  ModelInputContextSchema,
  type AgentInstructionSourceSnapshot,
  type ModelInputContext,
} from '@megumi/shared/model-input-context-contracts';
import type { ContextBudgetWarning } from '@megumi/shared/context-budget-contracts';
import { SessionContextInputSchema, type SessionContextInput } from '@megumi/shared/session-context-contracts';

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
          sessionKind: 'session_history',
          text: 'Earlier, the user confirmed the spec order.',
          sourceRefs: [sourceRef('session-message:1', 'session_message')],
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
          toolCallId: 'tool-call:1',
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
        {
          partId: 'part:instruction:intent:review',
          kind: 'instruction',
          instructionKind: 'intent',
          text: 'Input intent: code_review.',
          sourceRefs: [sourceRef('input-intent:review', 'input_intent')],
          priority: 95,
          tokenEstimate: 4,
          budgetStatus: 'included_full',
          metadata: {
            intent: {
              intentName: 'code_review',
              source: 'core_command',
              commandName: 'review',
              argsText: '当前改动',
            },
          },
        },
      ],
      budget: {
        modelContextWindow: 8192,
        reservedOutputTokens: 1024,
        availableInputTokens: 7168,
        keepRecentTokens: 4096,
        inputTokenEstimate: 33,
        partBudgets: [
          { partId: 'part:instruction:1', tokenEstimate: 4, budgetStatus: 'included_full' },
          { partId: 'part:current-turn:1', tokenEstimate: 5, budgetStatus: 'included_full' },
          { partId: 'part:session:1', tokenEstimate: 10, budgetStatus: 'included_reduced' },
          { partId: 'part:tool:1', tokenEstimate: 8, budgetStatus: 'included_full' },
          { partId: 'part:runtime:1', tokenEstimate: 6, budgetStatus: 'included_full' },
          { partId: 'part:instruction:intent:review', tokenEstimate: 4, budgetStatus: 'included_full' },
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
        firstKeptPartId: 'part:session:1',
        firstKeptSourceId: 'session-message:1',
        budgetWarnings: [
          {
            reason: 'required_context_over_budget',
            tokenEstimate: 9000,
            availableInputTokens: 7168,
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
      'instruction',
    ]);
    expect(parsed.parts[0]?.sourceRefs[0]?.sourceKind).toBe('system_instruction');
    expect(parsed.parts[2]?.budgetStatus).toBe('included_reduced');
    expect(parsed.budget.keepRecentTokens).toBe(4096);
    expect(parsed.trace.firstKeptPartId).toBe('part:session:1');
    expect(parsed.trace.firstKeptSourceId).toBe('session-message:1');
    expect(parsed.trace.budgetWarnings).toEqual([
      {
        reason: 'required_context_over_budget',
        tokenEstimate: 9000,
        availableInputTokens: 7168,
      } satisfies ContextBudgetWarning,
    ]);
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
        keepRecentTokens: 4096,
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

  it('rejects budget policy fields on trace warnings and requires keepRecentTokens', () => {
    expect(() => ModelInputContextSchema.parse({
      contextId: 'model-input-context:missing-keep-recent',
      sessionId: 'session:1',
      runId: 'run:1',
      stepId: 'step:1',
      parts: [],
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
    })).toThrow();

    expect(() => ModelInputContextSchema.parse({
      contextId: 'model-input-context:warning-extra',
      sessionId: 'session:1',
      runId: 'run:1',
      stepId: 'step:1',
      parts: [],
      budget: {
        modelContextWindow: 8192,
        reservedOutputTokens: 1024,
        availableInputTokens: 7168,
        keepRecentTokens: 4096,
        inputTokenEstimate: 0,
        partBudgets: [],
      },
      trace: {
        buildReason: 'test',
        selectedSources: [],
        excludedSources: [],
        budgetWarnings: [{
          reason: 'required_context_over_budget',
          tokenEstimate: 9000,
          availableInputTokens: 7168,
          rawPrompt: 'must not be accepted',
        }],
      },
      builtAt,
    })).toThrow();
  });

  it('requires session parts to declare their session kind', () => {
    expect(() => ModelInputContextSchema.parse({
      contextId: 'model-input-context:session-kind',
      sessionId: 'session:1',
      runId: 'run:1',
      stepId: 'step:1',
      parts: [{
        partId: 'part:session:missing-kind',
        kind: 'session',
        text: 'Earlier context without a semantic session kind.',
        sourceRefs: [sourceRef('session-message:1', 'session_message')],
        priority: 50,
        budgetStatus: 'included_reduced',
      }],
      budget: {
        modelContextWindow: 8192,
        reservedOutputTokens: 1024,
        availableInputTokens: 7168,
        keepRecentTokens: 4096,
        inputTokenEstimate: 0,
        partBudgets: [],
      },
      trace: {
        buildReason: 'test',
        selectedSources: [],
        excludedSources: [],
      },
      builtAt,
    })).toThrow();
  });

  it('parses explicit session context input contracts', () => {
    const parsed = SessionContextInputSchema.parse({
      historyEntries: [
        {
          entryId: 'history:1',
          role: 'user',
          text: 'Do not implement long-term memory in this phase.',
          status: 'completed',
          sourceRef: sourceRef('session-message:history-1', 'session_message'),
          createdAt: builtAt,
          completedAt: builtAt,
        },
        {
          entryId: 'history:2',
          role: 'assistant',
          text: 'We will focus on Session Context.',
          status: 'completed',
          sourceRef: sourceRef('session-message:history-2', 'session_message'),
          createdAt: builtAt,
          completedAt: builtAt,
        },
      ],
      runtimeFacts: [
        {
          factId: 'fact:approval-denied',
          factKind: 'approval',
          text: 'User denied write_file for package.json.',
          sourceRef: sourceRef('approval:1', 'approval'),
          severity: 'warning',
          createdAt: builtAt,
        },
      ],
      summaryEntries: [
        {
          summaryId: 'summary:1',
          text: 'Earlier discussion selected short-term context quality as the 07 goal.',
          sourceRef: sourceRef('session-summary:1', 'session_summary'),
          createdAt: builtAt,
        },
      ],
      maxHistoryEntries: 8,
    });

    expect(parsed).toEqual({
      historyEntries: [
        {
          entryId: 'history:1',
          role: 'user',
          text: 'Do not implement long-term memory in this phase.',
          status: 'completed',
          sourceRef: sourceRef('session-message:history-1', 'session_message'),
          createdAt: builtAt,
          completedAt: builtAt,
        },
        {
          entryId: 'history:2',
          role: 'assistant',
          text: 'We will focus on Session Context.',
          status: 'completed',
          sourceRef: sourceRef('session-message:history-2', 'session_message'),
          createdAt: builtAt,
          completedAt: builtAt,
        },
      ],
      runtimeFacts: [
        {
          factId: 'fact:approval-denied',
          factKind: 'approval',
          text: 'User denied write_file for package.json.',
          sourceRef: sourceRef('approval:1', 'approval'),
          severity: 'warning',
          createdAt: builtAt,
        },
      ],
      summaryEntries: [
        {
          summaryId: 'summary:1',
          text: 'Earlier discussion selected short-term context quality as the 07 goal.',
          sourceRef: sourceRef('session-summary:1', 'session_summary'),
          createdAt: builtAt,
        },
      ],
      maxHistoryEntries: 8,
    } satisfies SessionContextInput);
  });

  it('rejects invalid session context input shapes', () => {
    expect(() => SessionContextInputSchema.parse({
      historyEntries: [{
        entryId: 'history:bad',
        role: 'assistant',
        text: '',
        status: 'completed',
        sourceRef: sourceRef('session-message:bad', 'session_message'),
      }],
    })).toThrow();

    expect(() => SessionContextInputSchema.parse({
      runtimeFacts: [{
        factId: 'fact:bad',
        factKind: 'tool_result',
        text: 'raw fact',
        sourceRef: sourceRef('tool-result:1', 'tool_result'),
        severity: 'critical',
      }],
    })).toThrow();
  });

  it('accepts structured tool continuation replay fields without exposing raw provider bodies', () => {
    const context = ModelInputContextSchema.parse({
      contextId: 'model-input-context:tool-replay',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-2',
      parts: [
        {
          partId: 'part:tool-call:1',
          kind: 'tool_continuation',
          text: 'Tool call tool-call-1 requested read_file.',
          sourceRefs: [{ sourceId: 'tool-call:tool-call-1', sourceKind: 'tool_call' }],
          priority: 80,
          budgetStatus: 'included_full',
          toolCallId: 'tool-call-1',
          providerToolCallId: 'provider-tool-call-1',
          modelStepId: 'model-step-1',
          toolName: 'read_file',
          toolInput: { path: 'package.json' },
        },
        {
          partId: 'part:tool-result:1',
          kind: 'tool_continuation',
          text: 'Tool result tool-result-1 for tool-call-1.',
          sourceRefs: [{ sourceId: 'tool-result:tool-result-1', sourceKind: 'tool_result' }],
          priority: 85,
          budgetStatus: 'included_full',
          toolCallId: 'tool-call-1',
          toolResultId: 'tool-result-1',
          toolResultContent: 'File contents',
        },
        {
          partId: 'part:provider-state:1',
          kind: 'tool_continuation',
          text: 'I need to inspect package.json.',
          sourceRefs: [{ sourceId: 'provider-state:model-step-1:0', sourceKind: 'provider_state' }],
          priority: 75,
          budgetStatus: 'included_full',
          modelStepId: 'model-step-1',
          providerStateIds: ['model-step-1:0'],
          providerStateText: 'I need to inspect package.json.',
        },
      ],
      budget: {
        modelContextWindow: 8192,
        reservedOutputTokens: 1024,
        availableInputTokens: 7168,
        keepRecentTokens: 4096,
        inputTokenEstimate: 12,
        partBudgets: [
          { partId: 'part:tool-call:1', tokenEstimate: 4, budgetStatus: 'included_full' },
          { partId: 'part:tool-result:1', tokenEstimate: 4, budgetStatus: 'included_full' },
          { partId: 'part:provider-state:1', tokenEstimate: 4, budgetStatus: 'included_full' },
        ],
      },
      trace: {
        buildReason: 'tool_continuation',
        selectedSources: [
          { sourceId: 'tool-call:tool-call-1', reason: 'tool_continuation' },
          { sourceId: 'tool-result:tool-result-1', reason: 'tool_continuation' },
          { sourceId: 'provider-state:model-step-1:0', reason: 'tool_continuation' },
        ],
        excludedSources: [],
      },
      builtAt,
    });

    expect(context.parts[0]).toMatchObject({
      toolCallId: 'tool-call-1',
      providerToolCallId: 'provider-tool-call-1',
      toolName: 'read_file',
      toolInput: { path: 'package.json' },
    });
    expect(context.parts[1]).toMatchObject({
      toolResultContent: 'File contents',
    });
    expect(JSON.stringify(context)).not.toContain('rawProviderBody');
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
    expect(MODEL_INPUT_SESSION_PART_KINDS).toEqual([
      'session_history',
      'session_runtime_fact',
      'session_summary',
    ]);
    expect(MODEL_INPUT_INSTRUCTION_KINDS).toEqual([
      'system',
      'project',
      'mode',
      'developer',
      'user',
      'intent',
    ]);
    expect(() => ModelInputInstructionKindSchema.parse('workflow')).toThrow();
    expect(MODEL_INPUT_CONTEXT_SOURCE_KINDS).toEqual([
      'system_instruction',
      'project_instruction',
      'mode_instruction',
      'current_user_message',
      'run_goal',
      'timeline_message',
      'session_message',
      'session_run',
      'session_step',
      'session_runtime_fact',
      'session_summary',
      'branch_marker',
      'retry_attempt',
      'interrupted_run_marker',
      'tool_call',
      'tool_result',
      'approval',
      'provider_state',
      'permission_mode',
      'project_boundary',
      'runtime_constraint',
      'input_intent',
      'external_resource',
      'other',
    ]);
  });

  it('rejects legacy tool use continuation fields', () => {
    expect(() => ModelInputContextSchema.parse({
      contextId: 'model-input-context:legacy-tool-use',
      sessionId: 'session:1',
      runId: 'run:1',
      stepId: 'step:1',
      parts: [
        {
          partId: 'part:legacy-tool-use',
          kind: 'tool_continuation',
          text: 'Legacy tool use continuation.',
          sourceRefs: [{ sourceId: 'tool-use:legacy', sourceKind: 'tool_use' }],
          priority: 80,
          budgetStatus: 'included_full',
          toolUseId: 'tool-use-legacy',
          providerToolUseId: 'provider-tool-use-legacy',
        },
      ],
      budget: {
        modelContextWindow: 8192,
        reservedOutputTokens: 1024,
        availableInputTokens: 7168,
        keepRecentTokens: 4096,
        inputTokenEstimate: 4,
        partBudgets: [{ partId: 'part:legacy-tool-use', tokenEstimate: 4, budgetStatus: 'included_full' }],
      },
      trace: {
        buildReason: 'tool_continuation',
        selectedSources: [],
        excludedSources: [],
      },
      builtAt,
    })).toThrow();
  });
});

describe('AgentInstructionSourceSnapshot contracts', () => {
  const loadedAt = '2026-05-28T00:00:00.000Z';

  it('accepts included project instruction snapshots with file-level metadata', () => {
    const snapshot = AgentInstructionSourceSnapshotSchema.parse({
      sourceId: 'project-instruction:AGENTS.md',
      sourceKind: 'project_instruction',
      status: 'included',
      sourceUri: 'project://AGENTS.md',
      relativePath: 'AGENTS.md',
      text: '# AGENTS',
      loadedAt,
      sizeBytes: 8,
      includedBytes: 8,
      hardCapBytes: 65536,
      truncated: false,
    });

    expect(snapshot).toEqual({
      sourceId: 'project-instruction:AGENTS.md',
      sourceKind: 'project_instruction',
      status: 'included',
      sourceUri: 'project://AGENTS.md',
      relativePath: 'AGENTS.md',
      text: '# AGENTS',
      loadedAt,
      sizeBytes: 8,
      includedBytes: 8,
      hardCapBytes: 65536,
      truncated: false,
    } satisfies AgentInstructionSourceSnapshot);
  });

  it('accepts unavailable, missing, read_failed, and truncated statuses', () => {
    const statuses = [
      'unavailable',
      'missing',
      'read_failed',
      'included_truncated',
    ] as const;

    for (const status of statuses) {
      expect(() => AgentInstructionSourceSnapshotSchema.parse({
        sourceId: `project-instruction:${status}`,
        sourceKind: 'project_instruction',
        status,
        sourceUri: 'project://AGENTS.md',
        relativePath: 'AGENTS.md',
        loadedAt,
        reason: status === 'included_truncated'
          ? 'project_instruction_hard_cap_exceeded'
          : `agent_instruction_${status}`,
        ...(status === 'included_truncated' ? {
          text: '# AGENTS',
          sizeBytes: 70000,
          includedBytes: 65536,
          hardCapBytes: 65536,
          truncated: true,
        } : {}),
      })).not.toThrow();
    }
  });

  it('rejects unknown instruction source kinds and statuses', () => {
    expect(() => AgentInstructionSourceSnapshotSchema.parse({
      sourceId: 'project-instruction:bad',
      sourceKind: 'other',
      status: 'included',
      loadedAt,
      text: 'bad',
    })).toThrow();

    expect(() => AgentInstructionSourceSnapshotSchema.parse({
      sourceId: 'project-instruction:bad',
      sourceKind: 'project_instruction',
      status: 'cached',
      loadedAt,
      text: 'bad',
    })).toThrow();
  });

  it('rejects included snapshots without required file payload metadata', () => {
    const includedSnapshot = {
      sourceId: 'project-instruction:AGENTS.md',
      sourceKind: 'project_instruction',
      status: 'included',
      sourceUri: 'project://AGENTS.md',
      relativePath: 'AGENTS.md',
      text: '# AGENTS',
      loadedAt,
      sizeBytes: 8,
      includedBytes: 8,
      hardCapBytes: 65536,
      truncated: false,
    } as const;

    for (const requiredKey of ['text', 'sizeBytes', 'includedBytes', 'hardCapBytes', 'truncated'] as const) {
      const incomplete = { ...includedSnapshot };
      delete (incomplete as Record<string, unknown>)[requiredKey];

      expect(() => AgentInstructionSourceSnapshotSchema.parse(incomplete)).toThrow();
    }
  });

  it('rejects non-included snapshots carrying model-visible text', () => {
    for (const status of ['missing', 'unavailable', 'read_failed'] as const) {
      expect(() => AgentInstructionSourceSnapshotSchema.parse({
        sourceId: `project-instruction:${status}`,
        sourceKind: 'project_instruction',
        status,
        sourceUri: 'project://AGENTS.md',
        relativePath: 'AGENTS.md',
        text: 'must not be carried on excluded sources',
        loadedAt,
        reason: `agent_instruction_${status}`,
      })).toThrow();
    }
  });

  it('rejects unsafe project instruction source identity values', () => {
    expect(() => AgentInstructionSourceSnapshotSchema.parse({
      sourceId: 'project-instruction:AGENTS.md',
      sourceKind: 'project_instruction',
      status: 'included',
      sourceUri: 'file:///C:/project/AGENTS.md',
      relativePath: 'AGENTS.md',
      text: '# AGENTS',
      loadedAt,
      sizeBytes: 8,
      includedBytes: 8,
      hardCapBytes: 65536,
      truncated: false,
    })).toThrow();

    expect(() => AgentInstructionSourceSnapshotSchema.parse({
      sourceId: 'project-instruction:AGENTS.md',
      sourceKind: 'project_instruction',
      status: 'included',
      sourceUri: 'project://AGENTS.md',
      relativePath: '../AGENTS.md',
      text: '# AGENTS',
      loadedAt,
      sizeBytes: 8,
      includedBytes: 8,
      hardCapBytes: 65536,
      truncated: false,
    })).toThrow();
  });

  it('rejects truncated snapshots without the hard-cap reason and truncated flag', () => {
    expect(() => AgentInstructionSourceSnapshotSchema.parse({
      sourceId: 'project-instruction:AGENTS.md',
      sourceKind: 'project_instruction',
      status: 'included_truncated',
      sourceUri: 'project://AGENTS.md',
      relativePath: 'AGENTS.md',
      text: '# AGENTS',
      loadedAt,
      sizeBytes: 70000,
      includedBytes: 65536,
      hardCapBytes: 65536,
      truncated: false,
      reason: 'project_instruction_hard_cap_exceeded',
    })).toThrow();

    expect(() => AgentInstructionSourceSnapshotSchema.parse({
      sourceId: 'project-instruction:AGENTS.md',
      sourceKind: 'project_instruction',
      status: 'included_truncated',
      sourceUri: 'project://AGENTS.md',
      relativePath: 'AGENTS.md',
      text: '# AGENTS',
      loadedAt,
      sizeBytes: 70000,
      includedBytes: 65536,
      hardCapBytes: 65536,
      truncated: true,
      reason: 'agent_instruction_read_failed',
    })).toThrow();
  });
});
