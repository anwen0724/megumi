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
  it('keeps the ten most recent completed Turns and compacts every older Turn', () => {
    const turns = Array.from({ length: 25 }, (_, index) => turn(String(index + 1)));

    const result = planCompaction({
      historicalTurns: turns,
      keepRecentTurns: 10,
      currentTurn: currentTurn('current', 'entry-assistant-25'),
    });

    expect(result).toEqual({
      status: 'planned',
      plan: {
        turns: turns.slice(0, 15),
        coveredUntilEntryId: 'entry-assistant-15',
        firstKeptEntryId: 'entry-user-16',
      },
    });
  });

  it('does not count the Current Turn among ten retained completed Turns', () => {
    const turns = Array.from({ length: 11 }, (_, index) => turn(String(index + 1)));
    const current = currentTurn('current', 'entry-assistant-11');
    const result = planCompaction({
      historicalTurns: turns,
      keepRecentTurns: 10,
      currentTurn: current,
    });

    expect(result.status).toBe('planned');
    if (result.status !== 'planned') throw new Error('Expected a plan.');
    expect(result.plan.turns.map(({ source }) => source.runId)).toEqual(['run-1']);
    expect(result.plan.turns).not.toContain(current);
    expect(result.plan.firstKeptEntryId).toBe('entry-user-2');
  });

  it('returns no_historical_turns without producing a plan', () => {
    expect(planCompaction({
      historicalTurns: [],
      keepRecentTurns: 10,
    })).toEqual({ status: 'nothing_to_compact', reason: 'no_historical_turns' });
  });

  it('returns no_older_turns when all completed Turns fit within retention', () => {
    expect(planCompaction({
      historicalTurns: Array.from({ length: 10 }, (_, index) => turn(String(index + 1))),
      keepRecentTurns: 10,
    })).toEqual({ status: 'nothing_to_compact', reason: 'no_older_turns' });
  });
});

describe('validateCompactionReduction', () => {
  it('accepts a reducing Summary even when the result remains above threshold', () => {
    expect(validateCompactionReduction({
      usageBeforeInputTokens: 1_000,
      usageAfterInputTokens: 900,
    })).toEqual({ status: 'valid' });
  });

  it.each([1_000, 1_100])(
    'rejects a same-size or larger Summary result at %i tokens',
    (usageAfterInputTokens) => {
      expect(validateCompactionReduction({
        usageBeforeInputTokens: 1_000,
        usageAfterInputTokens,
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
      lastEntryId: `entry-assistant-${id}`,
      responseMessageRefs: [{ entryId: `entry-assistant-${id}`, messageId: `message-assistant-${id}` }],
    },
    userMessage: {
      type: 'user_message',
      content: [{ type: 'text', text: `User ${id}` }],
    },
    items: [
      { type: 'tool_call', toolCallId: `call-${id}`, toolName: 'lookup', arguments: { id } },
      { type: 'tool_result', toolCallId: `call-${id}`, toolName: 'lookup', status: 'success', content: [{ type: 'text', text: `Result ${id}` }] },
      { type: 'assistant_message', content: [{ type: 'text', text: `Assistant ${id}` }] },
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
