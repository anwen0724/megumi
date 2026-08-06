/* Verifies pure compaction planning protects recent Tokens and messages with protocol closure. */
import { describe, expect, it } from 'vitest';
import type { Message } from '@megumi/ai';
import {
  planCompaction,
  validateCompactionReduction,
  type CompactionMessageSource,
} from '../../../packages/context/src/compaction/compaction-planner';
import { DEFAULT_COMPACTION_POLICY } from '../../../packages/context/src/index';

function source(entryId: string, message: Message): CompactionMessageSource {
  return { entryId, message };
}

function user(entryId: string, text: string): CompactionMessageSource {
  return source(entryId, { role: 'user', content: [{ type: 'text', text }], timestamp: 0 });
}

function assistant(entryId: string, text: string, toolCallId?: string): CompactionMessageSource {
  return source(entryId, {
    role: 'assistant',
    content: toolCallId
      ? [{ type: 'text', text }, { type: 'toolCall', id: toolCallId, name: 'read_file', arguments: {} }]
      : [{ type: 'text', text }],
    api: 'openai-completions',
    provider: 'openai',
    model: 'gpt',
    stopReason: toolCallId ? 'toolUse' : 'stop',
    timestamp: 0,
  });
}

function toolResult(entryId: string, toolCallId: string): CompactionMessageSource {
  return source(entryId, {
    role: 'toolResult',
    toolCallId,
    toolName: 'read_file',
    content: [{ type: 'text', text: 'result' }],
    isError: false,
    timestamp: 0,
  });
}

const estimateTokens = (message: Message) => JSON.stringify(message).length;

describe('planCompaction', () => {
  it('protects both keepRecentTokens and minimumRecentMessages', () => {
    const sources = [user('e1', 'a'), user('e2', 'b'), user('e3', 'c')];
    // With tokens too small to matter, the message count decides the cut.
    const plan = planCompaction({
      sources,
      policy: { ...DEFAULT_COMPACTION_POLICY, keepRecentTokens: 1, minimumRecentMessages: 2 },
      estimateMessageTokens: estimateTokens,
    });
    expect(plan.status).toBe('planned');
    if (plan.status !== 'planned') return;
    expect(plan.plan.summarizedMessages).toHaveLength(1);
    expect(plan.plan.coveredUntilEntryId).toBe('e1');
    expect(plan.plan.firstKeptEntryId).toBe('e2');
    // A cut on a clean Turn boundary carries no Turn Prefix.
    expect(plan.plan.turnPrefixMessages).toEqual([]);
  });

  it('never cuts directly before a ToolResult and keeps the loop closed', () => {
    const sources = [
      user('e1', 'a'),
      assistant('e2', 'call', 'call:1'),
      toolResult('e3', 'call:1'),
    ];
    const plan = planCompaction({
      sources,
      policy: { ...DEFAULT_COMPACTION_POLICY, keepRecentTokens: 1, minimumRecentMessages: 1 },
      estimateMessageTokens: estimateTokens,
    });
    expect(plan.status).toBe('planned');
    if (plan.status !== 'planned') return;
    // The walk would cut before the trailing ToolResult; closure keeps the whole loop.
    expect(plan.plan.summarizedMessages).toHaveLength(1);
    expect(plan.plan.firstKeptEntryId).toBe('e2');
    // The ToolCall pulled into the kept suffix is the Turn Prefix.
    expect(plan.plan.turnPrefixMessages).toEqual([assistant('e2', 'call', 'call:1').message]);
  });

  it('moves a mid-loop cut before the issuing ToolCall and marks the turn prefix', () => {
    const sources = [
      user('e1', 'a'),
      assistant('e2', 'call', 'call:1'),
      toolResult('e3', 'call:1'),
      user('e4', 'b'),
      user('e5', 'c'),
    ];
    const plan = planCompaction({
      sources,
      policy: { ...DEFAULT_COMPACTION_POLICY, keepRecentTokens: 1, minimumRecentMessages: 3 },
      estimateMessageTokens: estimateTokens,
    });
    expect(plan.status).toBe('planned');
    if (plan.status !== 'planned') return;
    // e3 is a ToolResult directly after the cut candidate: closure extends to e2.
    expect(plan.plan.firstKeptEntryId).toBe('e2');
    // The Turn Prefix holds the partially-cut Tool loop: it is never part of
    // the replaced entries and stays in the kept suffix.
    expect(plan.plan.turnPrefixMessages).toEqual([assistant('e2', 'call', 'call:1').message]);
    expect(plan.plan.summarizedMessages).toEqual([user('e1', 'a').message]);
    expect(plan.plan.coveredUntilEntryId).toBe('e1');
    expect(plan.plan.firstKeptEntryId).toBe('e2');
    // The Turn Prefix carries the ToolCall whose loop closure kept it open.
    const prefix = plan.plan.turnPrefixMessages[0]!;
    expect(prefix.role).toBe('assistant');
    expect(prefix.content).toContainEqual(expect.objectContaining({ type: 'toolCall', id: 'call:1' }));
  });

  it('returns nothing_to_compact when protocol closure consumes the whole history', () => {
    // The Token threshold is met at the ToolResult so the initial cut lands
    // directly before it; closing the protocol extends the cut to the very first
    // message, which leaves no summarized prefix instead of crashing.
    const sources = [
      assistant('e1', 'call', 'call:1'),
      toolResult('e2', 'call:1'),
      user('e3', 'b'),
      user('e4', 'c'),
    ];
    const plan = planCompaction({
      sources,
      policy: { ...DEFAULT_COMPACTION_POLICY, keepRecentTokens: 1, minimumRecentMessages: 3 },
      estimateMessageTokens: estimateTokens,
    });
    expect(plan).toEqual({ status: 'nothing_to_compact', reason: 'no_older_messages' });
  });

  it('keeps empty and non-reducing outcomes distinct', () => {
    expect(planCompaction({
      sources: [],
      policy: DEFAULT_COMPACTION_POLICY,
      estimateMessageTokens: estimateTokens,
    })).toEqual({ status: 'nothing_to_compact', reason: 'no_historical_messages' });
    expect(planCompaction({
      sources: [user('e1', 'a')],
      policy: { ...DEFAULT_COMPACTION_POLICY, keepRecentTokens: 1, minimumRecentMessages: 2 },
      estimateMessageTokens: estimateTokens,
    })).toEqual({ status: 'nothing_to_compact', reason: 'no_older_messages' });
    expect(validateCompactionReduction({
      usageBeforeInputTokens: 20,
      usageAfterInputTokens: 20,
    })).toEqual({ status: 'nothing_to_compact', reason: 'summary_not_reducing' });
  });
});
