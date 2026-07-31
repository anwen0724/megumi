/* Verifies pure compaction planning preserves complete recent Runs. */
import { describe, expect, it } from 'vitest';
import type { ConversationRun } from '../../../packages/context/src/conversation-run';
import {
  planCompaction,
  validateCompactionReduction,
} from '../../../packages/context/src/compaction/compaction-planner';

function run(id: string): ConversationRun {
  return {
    source: {
      runId: id,
      userEntryId: `entry:user:${id}`,
      userMessageId: `message:user:${id}`,
      lastEntryId: `entry:last:${id}`,
      responseMessageRefs: [],
    },
    userMessage: { type: 'user_message', content: [{ type: 'text', text: id }] },
    items: [],
  };
}

describe('planCompaction', () => {
  it('selects a historical prefix and points to the first retained complete Run', () => {
    expect(planCompaction({
      historicalRuns: [run('1'), run('2'), run('3')],
      keepRecentRuns: 2,
    })).toEqual({
      status: 'planned',
      plan: {
        runs: [run('1')],
        coveredUntilEntryId: 'entry:last:1',
        firstKeptEntryId: 'entry:user:2',
      },
    });
  });

  it('keeps empty and non-reducing outcomes distinct', () => {
    expect(planCompaction({ historicalRuns: [], keepRecentRuns: 2 })).toEqual({
      status: 'nothing_to_compact',
      reason: 'no_historical_runs',
    });
    expect(planCompaction({ historicalRuns: [run('1')], keepRecentRuns: 1 })).toEqual({
      status: 'nothing_to_compact',
      reason: 'no_older_runs',
    });
    expect(validateCompactionReduction({
      usageBeforeInputTokens: 20,
      usageAfterInputTokens: 20,
    })).toEqual({ status: 'nothing_to_compact', reason: 'summary_not_reducing' });
  });
});
