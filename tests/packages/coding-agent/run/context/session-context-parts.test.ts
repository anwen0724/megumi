import { describe, expect, it } from 'vitest';
import { buildSessionContextParts } from '@megumi/coding-agent/context';
import type { ModelInputContextSourceRef } from '@megumi/shared/model';
import type { SessionContextInput, SessionHistoryEntryStatus } from '@megumi/shared/session';

const builtAt = '2026-05-29T00:00:00.000Z';

function sourceRef(
  sourceId: string,
  sourceKind: ModelInputContextSourceRef['sourceKind'],
): ModelInputContextSourceRef {
  return {
    sourceId,
    sourceKind,
    sourceUri: `${sourceKind}://${sourceId}`,
    loadedAt: builtAt,
    metadata: { fixture: true },
  };
}

describe('buildSessionContextParts', () => {
  it('builds summary, completed history, and runtime fact parts from explicit input', () => {
    const input: SessionContextInput = {
      historyEntries: [
        {
          entryId: 'history:user-correction',
          role: 'user',
          text: 'Do not implement long-term memory in this phase.',
          status: 'completed',
          sourceRef: sourceRef('session-message:user-correction', 'session_message'),
          createdAt: builtAt,
          completedAt: builtAt,
        },
        {
          entryId: 'history:assistant-decision',
          role: 'assistant',
          text: 'We will keep 07.03 focused on current session context.',
          status: 'completed',
          sourceRef: sourceRef('session-message:assistant-decision', 'session_message'),
          createdAt: builtAt,
          completedAt: builtAt,
        },
      ],
      runtimeFacts: [
        {
          factId: 'fact:approval-denied',
          factKind: 'approval',
          text: 'User denied write_file for package.json.',
          sourceRef: sourceRef('approval:denied-1', 'approval'),
          severity: 'warning',
          createdAt: builtAt,
        },
      ],
      summaryEntries: [
        {
          summaryId: 'summary:explicit-1',
          summaryKind: 'explicit',
          text: 'Earlier discussion selected short-term context quality as the stage goal.',
          sourceRef: sourceRef('session-summary:explicit-1', 'session_summary'),
          createdAt: builtAt,
        },
      ],
    };

    const result = buildSessionContextParts({ input, builtAt });

    expect(result.parts.map((part) => [
      part.kind,
      part.kind === 'session' ? part.sessionKind : undefined,
    ])).toEqual([
      ['session', 'session_summary'],
      ['session', 'session_history'],
      ['session', 'session_history'],
      ['session', 'session_runtime_fact'],
    ]);
    expect(result.parts[0]).toEqual({
      partId: 'part:session-summary:summary:explicit-1',
      kind: 'session',
      sessionKind: 'session_summary',
      text: 'Earlier discussion selected short-term context quality as the stage goal.',
      sourceRefs: [sourceRef('session-summary:explicit-1', 'session_summary')],
      priority: 45,
      metadata: {
        summaryKind: 'explicit',
      },
    });
    expect(result.parts[1]).toEqual({
      partId: 'part:session-history:history:user-correction',
      kind: 'session',
      sessionKind: 'session_history',
      text: '[user] Do not implement long-term memory in this phase.',
      sourceRefs: [sourceRef('session-message:user-correction', 'session_message')],
      priority: 60,
      metadata: {
        role: 'user',
        status: 'completed',
      },
    });
    expect(result.parts[3]).toEqual({
      partId: 'part:session-runtime-fact:fact:approval-denied',
      kind: 'session',
      sessionKind: 'session_runtime_fact',
      text: '[approval] User denied write_file for package.json.',
      sourceRefs: [sourceRef('approval:denied-1', 'approval')],
      priority: 75,
      metadata: {
        factKind: 'approval',
        severity: 'warning',
      },
    });
    expect(result.parts[0]).not.toHaveProperty('budgetStatus');
    expect(result.parts[0]).not.toHaveProperty('tokenEstimate');
    expect(result.excludedSources).toEqual([]);
  });

  it('excludes failed, cancelled, and interrupted history while keeping runtime facts', () => {
    const historyEntries = (['failed', 'cancelled', 'interrupted'] as SessionHistoryEntryStatus[]).map((status) => ({
      entryId: `history:${status}`,
      role: 'assistant' as const,
      text: `Partial ${status} assistant text must not appear.`,
      status,
      sourceRef: sourceRef(`session-message:${status}`, 'session_message'),
      createdAt: builtAt,
    }));
    const input: SessionContextInput = {
      historyEntries: [
        {
          entryId: 'history:completed',
          role: 'user',
          text: 'Continue with only completed context.',
          status: 'completed',
          sourceRef: sourceRef('session-message:completed', 'session_message'),
          createdAt: builtAt,
          completedAt: builtAt,
        },
        ...historyEntries,
      ],
      runtimeFacts: [
        {
          factId: 'fact:run-failed',
          factKind: 'run_failed',
          text: 'Previous run failed before producing a final answer.',
          sourceRef: sourceRef('session-run:failed', 'session_run'),
          severity: 'error',
          createdAt: builtAt,
        },
      ],
    };

    const result = buildSessionContextParts({ input, builtAt });

    expect(result.parts.map((part) => (part.kind === 'session' ? part.sessionKind : undefined))).toEqual([
      'session_history',
      'session_runtime_fact',
    ]);
    expect(JSON.stringify(result.parts)).not.toContain('Partial failed assistant text must not appear.');
    expect(JSON.stringify(result.parts)).not.toContain('Partial cancelled assistant text must not appear.');
    expect(JSON.stringify(result.parts)).not.toContain('Partial interrupted assistant text must not appear.');
    expect(result.parts[1]).toMatchObject({
      sessionKind: 'session_runtime_fact',
      text: '[run_failed] Previous run failed before producing a final answer.',
      priority: 80,
      metadata: {
        factKind: 'run_failed',
        severity: 'error',
      },
    });
    expect(result.excludedSources).toEqual([
      {
        sourceRef: sourceRef('session-message:failed', 'session_message'),
        reason: 'session_history_status_failed',
      },
      {
        sourceRef: sourceRef('session-message:cancelled', 'session_message'),
        reason: 'session_history_status_cancelled',
      },
      {
        sourceRef: sourceRef('session-message:interrupted', 'session_message'),
        reason: 'session_history_status_interrupted',
      },
    ]);
  });

  it('does not pre-prune completed history before context budget is applied', () => {
    const input: SessionContextInput = {
      historyEntries: [
        {
          entryId: 'old-message',
          role: 'user',
          text: 'old request',
          status: 'completed',
          sourceRef: sourceRef('session-message:old-message', 'session_message'),
          createdAt: builtAt,
          completedAt: builtAt,
        },
        {
          entryId: 'new-message',
          role: 'assistant',
          text: 'new response',
          status: 'completed',
          sourceRef: sourceRef('session-message:new-message', 'session_message'),
          createdAt: builtAt,
          completedAt: builtAt,
        },
      ],
      maxHistoryEntries: 1,
    };

    const result = buildSessionContextParts({ input, builtAt });

    expect(result.parts.map((part) => part.partId)).toEqual([
      'part:session-history:old-message',
      'part:session-history:new-message',
    ]);
    expect(result.excludedSources).toEqual([]);
  });

  it('keeps generated part IDs within the model input part ID limit for valid long source IDs', () => {
    const longId = 'x'.repeat(128);
    const input: SessionContextInput = {
      summaryEntries: [
        {
          summaryId: longId,
          text: 'Long summary ID should not produce an invalid part ID.',
          sourceRef: sourceRef('session-summary:long', 'session_summary'),
          createdAt: builtAt,
        },
      ],
      historyEntries: [
        {
          entryId: longId,
          role: 'user',
          text: 'Long history ID should not produce an invalid part ID.',
          status: 'completed',
          sourceRef: sourceRef('session-message:long', 'session_message'),
          createdAt: builtAt,
          completedAt: builtAt,
        },
      ],
      runtimeFacts: [
        {
          factId: longId,
          factKind: 'run_failed',
          text: 'Long fact ID should not produce an invalid part ID.',
          sourceRef: sourceRef('session-run:long', 'session_run'),
          severity: 'error',
          createdAt: builtAt,
        },
      ],
    };

    const result = buildSessionContextParts({ input, builtAt });

    expect(result.parts.map((part) => part.partId.length)).toEqual([128, 128, 128]);
    expect(result.parts.every((part) => part.partId.length <= 128)).toBe(true);
  });

  it('keeps truncated part IDs distinct for long IDs that share the retained prefix', () => {
    const sharedPrefix = 'x'.repeat(127);
    const input: SessionContextInput = {
      historyEntries: [
        {
          entryId: `${sharedPrefix}a`,
          role: 'user',
          text: 'First long history ID should stay distinct after truncation.',
          status: 'completed',
          sourceRef: sourceRef('session-message:long-a', 'session_message'),
          createdAt: builtAt,
          completedAt: builtAt,
        },
        {
          entryId: `${sharedPrefix}b`,
          role: 'assistant',
          text: 'Second long history ID should stay distinct after truncation.',
          status: 'completed',
          sourceRef: sourceRef('session-message:long-b', 'session_message'),
          createdAt: builtAt,
          completedAt: builtAt,
        },
      ],
    };

    const result = buildSessionContextParts({ input, builtAt });
    const partIds = result.parts.map((part) => part.partId);

    expect(partIds.every((partId) => partId.length <= 128)).toBe(true);
    expect(new Set(partIds).size).toBe(2);
  });

  it('returns no parts or exclusions when input is empty', () => {
    expect(buildSessionContextParts({ builtAt })).toEqual({
      parts: [],
      excludedSources: [],
    });
  });
});
