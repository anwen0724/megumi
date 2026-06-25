import { describe, expect, it } from 'vitest';
import type { ContextBudgetPolicy } from '@megumi/shared/context';
import {
  buildSessionCompactionSummaryInputContext,
  extractSessionCompactionFileMetadata,
  prepareSessionCompactionInput,
  serializeSessionCompactionInput,
  shouldRunSessionCompaction,
} from '@megumi/coding-agent/run/context/session-compaction';
import { estimateModelInputContextTokens } from '@megumi/coding-agent/run/context/context-budget';
import { buildModelStepInputContextFromSources } from '@megumi/coding-agent/run/context/model-step-input-context';
import type { ModelInputContextSourceRef } from '@megumi/shared/model';
import type {
  SessionContextInput,
  SessionHistoryEntry,
  SessionRuntimeFact,
  SessionSummaryEntry,
} from '@megumi/shared/session';

const builtAt = '2026-05-31T11:00:00.000Z';

function sourceRef(
  sourceId: string,
  sourceKind: ModelInputContextSourceRef['sourceKind'],
): ModelInputContextSourceRef {
  return {
    sourceId,
    sourceKind,
    sourceUri: `${sourceKind}://${sourceId}`,
    loadedAt: builtAt,
  };
}

function historyEntry(
  entryId: string,
  role: SessionHistoryEntry['role'],
  text: string,
): SessionHistoryEntry {
  return {
    entryId,
    role,
    text,
    status: 'completed',
    sourceRef: sourceRef(entryId, 'session_message'),
    createdAt: builtAt,
    completedAt: builtAt,
  };
}

function sessionContext(
  overrides: Partial<SessionContextInput> = {},
): SessionContextInput {
  const previousSummary: SessionSummaryEntry = {
    summaryId: 'summary-1',
    summaryKind: 'compaction',
    text: '此前已总结的内容。',
    sourceRef: sourceRef('summary-1', 'session_summary'),
    createdAt: '2026-05-31T09:00:00.000Z',
  };
  const runtimeFact: SessionRuntimeFact = {
    factId: 'tool-1',
    factKind: 'tool_result',
    text: 'x'.repeat(1500),
    sourceRef: sourceRef('tool-1', 'tool_result'),
    createdAt: '2026-05-31T10:01:30.000Z',
  };

  return {
    summaryEntries: [previousSummary],
    historyEntries: [
      historyEntry('message-1', 'user', '请分析项目状态。'),
      {
        entryId: 'message-failed',
        role: 'assistant',
        text: '这条失败回复不能参与摘要边界。',
        status: 'failed',
        sourceRef: sourceRef('message-failed', 'session_message'),
        createdAt: builtAt,
      },
      historyEntry('message-2', 'assistant', '项目当前处于 09 阶段。'),
      historyEntry('message-3', 'user', '写 Plan 1。'),
    ],
    runtimeFacts: [runtimeFact],
    ...overrides,
  };
}

describe('prepareSessionCompactionInput', () => {
  it('keeps newest completed history under keepRecentTokens and summarizes old completed history', () => {
    const prepared = prepareSessionCompactionInput({
      sessionId: 'session-1',
      builtAt,
      sessionContext: sessionContext(),
      keepRecentTokens: 3,
      tokensBefore: 190000,
    });

    expect(prepared).not.toBeNull();
    expect(prepared?.firstKeptSourceRef).toEqual(sourceRef('message-3', 'session_message'));
    expect(prepared?.historyEntriesToSummarize.map((entry) => entry.entryId)).toEqual([
      'message-1',
      'message-2',
    ]);
    expect(prepared?.keptHistoryEntries.map((entry) => entry.entryId)).toEqual(['message-3']);
    expect(JSON.stringify(prepared)).not.toContain('message-failed');
  });

  it('returns null when there is no old completed history to summarize', () => {
    const prepared = prepareSessionCompactionInput({
      sessionId: 'session-1',
      builtAt,
      sessionContext: sessionContext({
        historyEntries: [
          historyEntry('message-1', 'user', '只有一条完成历史。'),
          {
            entryId: 'message-failed',
            role: 'assistant',
            text: '失败历史不能让 compaction 有可摘要内容。',
            status: 'failed',
            sourceRef: sourceRef('message-failed', 'session_message'),
            createdAt: builtAt,
          },
        ],
      }),
      keepRecentTokens: 100,
      tokensBefore: 190000,
    });

    expect(prepared).toBeNull();
  });

  it('keeps older recent history when it exactly fits the token budget', () => {
    const context = sessionContext();
    const latestTwoTokenEstimate = estimateModelInputContextTokens(
      '[assistant] 项目当前处于 09 阶段。',
    ) + estimateModelInputContextTokens('[user] 写 Plan 1。');

    const prepared = prepareSessionCompactionInput({
      sessionId: 'session-1',
      builtAt,
      sessionContext: context,
      keepRecentTokens: latestTwoTokenEstimate,
      tokensBefore: 190000,
    });

    expect(prepared).not.toBeNull();
    expect(prepared?.historyEntriesToSummarize.map((entry) => entry.entryId)).toEqual([
      'message-1',
    ]);
    expect(prepared?.keptHistoryEntries.map((entry) => entry.entryId)).toEqual([
      'message-2',
      'message-3',
    ]);
  });

  it('keeps older recent history when adding it crosses the token target', () => {
    const context = sessionContext();
    const latestTokenEstimate = estimateModelInputContextTokens('[user] 写 Plan 1。');
    const previousTokenEstimate = estimateModelInputContextTokens(
      '[assistant] 项目当前处于 09 阶段。',
    );

    const prepared = prepareSessionCompactionInput({
      sessionId: 'session-1',
      builtAt,
      sessionContext: context,
      keepRecentTokens: latestTokenEstimate + Math.max(1, Math.floor(previousTokenEstimate / 2)),
      tokensBefore: 190000,
    });

    expect(prepared).not.toBeNull();
    expect(prepared?.historyEntriesToSummarize.map((entry) => entry.entryId)).toEqual([
      'message-1',
    ]);
    expect(prepared?.keptHistoryEntries.map((entry) => entry.entryId)).toEqual([
      'message-2',
      'message-3',
    ]);
  });

  it('throws when keepRecentTokens is negative', () => {
    expect(() =>
      prepareSessionCompactionInput({
        sessionId: 'session-1',
        builtAt,
        sessionContext: sessionContext(),
        keepRecentTokens: -1,
        tokensBefore: 190000,
      }),
    ).toThrow('keepRecentTokens must be non-negative');
  });
});

describe('shouldRunSessionCompaction', () => {
  it('triggers when budget probe input tokens exceed the available model input budget', () => {
    const budgetPolicy: ContextBudgetPolicy = {
      modelContextWindow: 40,
      reservedOutputTokens: 10,
      keepRecentTokens: 12,
    };
    const budgetProbe = buildModelStepInputContextFromSources({
      contextId: 'model-input-context:step-1:compaction-probe',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      buildReason: 'model_step_compaction_probe',
      builtAt,
      sessionContext: sessionContext({
        historyEntries: [
          historyEntry('message-1', 'user', 'a'.repeat(80)),
          historyEntry('message-2', 'assistant', 'b'.repeat(80)),
          historyEntry('message-3', 'user', 'c'.repeat(80)),
        ],
      }),
      budgetPolicy: {
        modelContextWindow: 1_000_000,
        reservedOutputTokens: 0,
        keepRecentTokens: 1_000_000,
      },
    });

    expect(shouldRunSessionCompaction({
      budgetProbeInputContext: budgetProbe,
      budgetPolicy,
    })).toEqual({
      shouldCompact: true,
      triggerReason: 'context_budget_pressure',
      tokensBefore: budgetProbe.budget.inputTokenEstimate,
      availableInputTokens: 30,
    });
  });

  it('does not trigger when budget probe input fits the budget', () => {
    const budgetPolicy: ContextBudgetPolicy = {
      modelContextWindow: 8192,
      reservedOutputTokens: 1024,
      keepRecentTokens: 4096,
    };
    const budgetProbe = buildModelStepInputContextFromSources({
      contextId: 'model-input-context:step-1:compaction-probe',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      buildReason: 'model_step_compaction_probe',
      builtAt,
      sessionContext: sessionContext(),
      budgetPolicy: {
        modelContextWindow: 1_000_000,
        reservedOutputTokens: 0,
        keepRecentTokens: 1_000_000,
      },
    });

    expect(shouldRunSessionCompaction({
      budgetProbeInputContext: budgetProbe,
      budgetPolicy,
    })).toEqual({
      shouldCompact: false,
      triggerReason: 'context_budget_pressure',
      tokensBefore: budgetProbe.budget.inputTokenEstimate,
      availableInputTokens: 7168,
    });
  });
});

describe('buildSessionCompactionSummaryInputContext', () => {
  it('builds an internal summary ModelInputContext without tool continuation replay', () => {
    const prepared = prepareSessionCompactionInput({
      sessionId: 'session-1',
      builtAt,
      sessionContext: sessionContext(),
      keepRecentTokens: 3,
      tokensBefore: 190000,
    });

    expect(prepared).not.toBeNull();

    const inputContext = buildSessionCompactionSummaryInputContext({
      contextId: 'model-input-context:compaction-1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1:compaction',
      builtAt,
      prepared: prepared!,
      budgetPolicy: {
        modelContextWindow: 8192,
        reservedOutputTokens: 1024,
        keepRecentTokens: 4096,
      },
    });

    expect(inputContext.trace.buildReason).toBe('session_compaction_summary');
    expect(inputContext.parts.map((part) => part.kind)).toEqual([
      'instruction',
      'current_turn',
    ]);
    expect(inputContext.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'instruction',
        instructionKind: 'system',
        text: expect.stringContaining('context summarization assistant'),
      }),
      expect.objectContaining({
        kind: 'current_turn',
        role: 'user',
        text: expect.stringContaining('<conversation>'),
      }),
    ]));
    expect(inputContext.parts).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'tool_continuation' }),
    ]));
    expect(JSON.stringify(inputContext)).not.toContain('x'.repeat(1300));
  });
});

describe('extractSessionCompactionFileMetadata', () => {
  it('extracts read and modified file metadata from summary tags', () => {
    expect(extractSessionCompactionFileMetadata([
      '## Goal',
      'Continue 09.',
      '<read-files>',
      'packages/coding-agent/run/context/session-compaction.ts',
      '</read-files>',
      '<modified-files>',
      'apps/desktop/src/main/services/session-run.service.ts',
      '</modified-files>',
    ].join('\n'))).toEqual({
      readFiles: ['packages/coding-agent/run/context/session-compaction.ts'],
      modifiedFiles: ['apps/desktop/src/main/services/session-run.service.ts'],
    });
  });
});

describe('serializeSessionCompactionInput', () => {
  it('serializes previous summaries, old history, and truncated runtime fact text', () => {
    const prepared = prepareSessionCompactionInput({
      sessionId: 'session-1',
      builtAt,
      sessionContext: sessionContext(),
      keepRecentTokens: 3,
      tokensBefore: 190000,
    });

    expect(prepared).not.toBeNull();

    const text = serializeSessionCompactionInput(prepared!);

    expect(text).toContain('[compaction] 此前已总结的内容。');
    expect(text).toContain('[user] 请分析项目状态。');
    expect(text).toContain('[assistant] 项目当前处于 09 阶段。');
    expect(text).not.toContain('[user] 写 Plan 1。');
    expect(text).not.toContain('这条失败回复不能参与摘要边界。');
    expect(text).toContain('[runtime_fact:tool_result]');
    expect(text).toContain('[truncated]');
    expect(text.length).toBeLessThan(2500);
  });
});

