/*
 * Verifies pure rolling-compaction planning at complete historical Run boundaries.
 */
import { describe, expect, it } from 'vitest';
import type {
  ConversationRun,
  CurrentConversationRun,
} from '@megumi/agent/context';
import {
  planCompaction,
  validateCompactionReduction,
} from '@megumi/agent/context/service/internal/compaction-planner';

describe('planCompaction', () => {
  it('keeps the ten most recent completed Runs and compacts every older Run', () => {
    const runs = Array.from({ length: 25 }, (_, index) => run(String(index + 1)));

    const result = planCompaction({
      historicalRuns: runs,
      keepRecentRuns: 10,
      currentRun: currentRun('current', 'entry-assistant-25'),
    });

    expect(result).toEqual({
      status: 'planned',
      plan: {
        runs: runs.slice(0, 15),
        coveredUntilEntryId: 'entry-assistant-15',
        firstKeptEntryId: 'entry-user-16',
      },
    });
  });

  it('does not count the Current Run among ten retained completed Runs', () => {
    const runs = Array.from({ length: 11 }, (_, index) => run(String(index + 1)));
    const current = currentRun('current', 'entry-assistant-11');
    const result = planCompaction({
      historicalRuns: runs,
      keepRecentRuns: 10,
      currentRun: current,
    });

    expect(result.status).toBe('planned');
    if (result.status !== 'planned') throw new Error('Expected a plan.');
    expect(result.plan.runs.map(({ source }) => source.runId)).toEqual(['run-1']);
    expect(result.plan.runs).not.toContain(current);
    expect(result.plan.firstKeptEntryId).toBe('entry-user-2');
  });

  it('returns no_historical_runs without producing a plan', () => {
    expect(planCompaction({
      historicalRuns: [],
      keepRecentRuns: 10,
    })).toEqual({ status: 'nothing_to_compact', reason: 'no_historical_runs' });
  });

  it('returns no_older_runs when all completed Runs fit within retention', () => {
    expect(planCompaction({
      historicalRuns: Array.from({ length: 10 }, (_, index) => run(String(index + 1))),
      keepRecentRuns: 10,
    })).toEqual({ status: 'nothing_to_compact', reason: 'no_older_runs' });
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

function run(id: string): ConversationRun {
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

function currentRun(id: string, parentEntryId: string): CurrentConversationRun {
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
