/*
 * Verifies pure rolling-compaction planning at complete historical Turn boundaries.
 */
import { describe, expect, it } from 'vitest';
import type {
  ConversationTurn,
  CurrentConversationTurn,
} from '@megumi/coding-agent/context';
import {
  planCompaction,
  validateCompactionReduction,
} from '@megumi/coding-agent/context/service/internal/compaction-planner';

describe('planCompaction', () => {
  it('selects the smallest earliest continuous prefix expected to reach the threshold', () => {
    const turns = [turn('1'), turn('2'), turn('3')];

    const result = planCompaction({
      previousSummaryInputTokens: 50,
      nonCompressibleInputTokens: 500,
      historicalTurns: turns,
      historicalTurnInputTokens: [200, 250, 300],
      thresholdInputTokens: 1_050,
      currentTurn: currentTurn('current', 'entry-assistant-3'),
    });

    expect(result).toEqual({
      status: 'planned',
      plan: {
        turns: turns.slice(0, 2),
        coveredUntilEntryId: 'entry-assistant-2',
        firstKeptEntryId: 'entry-user-3',
      },
    });
  });

  it('keeps the Current Turn outside the selected prefix and uses it as the kept boundary', () => {
    const current = currentTurn('current', 'entry-assistant-2');
    const result = planCompaction({
      previousSummaryInputTokens: 0,
      nonCompressibleInputTokens: 700,
      historicalTurns: [turn('1'), turn('2')],
      historicalTurnInputTokens: [200, 200],
      thresholdInputTokens: 800,
      currentTurn: current,
    });

    expect(result.status).toBe('planned');
    if (result.status !== 'planned') throw new Error('Expected a plan.');
    expect(result.plan.turns.map(({ source }) => source.runId)).toEqual(['run-1', 'run-2']);
    expect(result.plan.turns).not.toContain(current);
    expect(result.plan.firstKeptEntryId).toBe('entry-user-current');
  });

  it('falls back once to the largest reducible prefix when no candidate reaches threshold', () => {
    const turns = [turn('1'), turn('2'), turn('3')];

    const result = planCompaction({
      previousSummaryInputTokens: 100,
      nonCompressibleInputTokens: 900,
      historicalTurns: turns,
      historicalTurnInputTokens: [100, 100, 100],
      thresholdInputTokens: 800,
    });

    expect(result).toEqual({
      status: 'planned',
      plan: {
        turns,
        coveredUntilEntryId: 'entry-assistant-3',
      },
    });
  });

  it('returns no_complete_turns without producing a plan', () => {
    expect(planCompaction({
      previousSummaryInputTokens: 50,
      nonCompressibleInputTokens: 900,
      historicalTurns: [],
      historicalTurnInputTokens: [],
      thresholdInputTokens: 800,
    })).toEqual({ status: 'nothing_to_compact', reason: 'no_complete_turns' });
  });

  it('returns no_reducible_prefix when every replacement projection is non-reducing', () => {
    expect(planCompaction({
      previousSummaryInputTokens: 100,
      nonCompressibleInputTokens: 700,
      historicalTurns: [turn('1'), turn('2')],
      historicalTurnInputTokens: [0, 0],
      thresholdInputTokens: 750,
    })).toEqual({ status: 'nothing_to_compact', reason: 'no_reducible_prefix' });
  });
});

describe('validateCompactionReduction', () => {
  it('accepts a reducing Summary even when the result remains above threshold', () => {
    expect(validateCompactionReduction({
      usageBeforeInputTokens: 1_000,
      usageAfterInputTokens: 900,
      thresholdInputTokens: 800,
    })).toEqual({ status: 'valid' });
  });

  it.each([1_000, 1_100])(
    'rejects a same-size or larger Summary result at %i tokens',
    (usageAfterInputTokens) => {
      expect(validateCompactionReduction({
        usageBeforeInputTokens: 1_000,
        usageAfterInputTokens,
        thresholdInputTokens: 800,
      })).toEqual({ status: 'nothing_to_compact', reason: 'summary_not_reducing' });
    },
  );
});

function turn(id: string): ConversationTurn {
  return {
    source: {
      runId: `run-${id}`,
      userEntryId: `entry-user-${id}`,
      userMessageId: `message-user-${id}`,
      assistantEntryId: `entry-assistant-${id}`,
      assistantMessageId: `message-assistant-${id}`,
    },
    userMessage: {
      type: 'user_message',
      content: [{ type: 'text', text: `User ${id}` }],
    },
    responseItems: [
      { type: 'tool_call', toolCallId: `call-${id}`, toolName: 'lookup', arguments: { id } },
      {
        type: 'tool_result',
        toolCallId: `call-${id}`,
        toolName: 'lookup',
        status: 'success',
        content: [{ type: 'text', text: `Result ${id}` }],
      },
      {
        type: 'assistant_message',
        content: [{ type: 'text', text: `Assistant ${id}` }],
      },
    ],
  };
}

function currentTurn(id: string, parentEntryId: string): CurrentConversationTurn {
  return {
    runId: `run-${id}`,
    userEntry: { entryId: `entry-user-${id}`, parentEntryId },
    userMessage: {
      type: 'user_message',
      content: [{ type: 'text', text: `User ${id}` }],
    },
    runItems: [],
  };
}
