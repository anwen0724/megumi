/* Verifies pure compaction planning protects recent Tokens and messages with protocol closure. */
import { describe, expect, it } from 'vitest';
import type { Message } from '@megumi/ai';
import {
  planCompaction,
} from '../../../packages/agent/context/src/compaction/compaction-planner';
import type { CompactionMessageSource } from '../../../packages/agent/context/src/prompt/context-message-builder';
import { DEFAULT_COMPACTION_POLICY } from '../../../packages/agent/context/src/index';

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
    usage: {
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
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

  it('never cuts an ordinary User -> Assistant Turn', () => {
    // The budget would keep only the trailing Assistant: the cut moves to the
    // Turn's UserMessage instead.
    const sources = [
      user('e1', 'a'),
      assistant('e2', 'b'),
      user('e3', 'c'),
      assistant('e4', 'd'),
    ];
    const plan = planCompaction({
      sources,
      policy: { ...DEFAULT_COMPACTION_POLICY, keepRecentTokens: 1, minimumRecentMessages: 1 },
      estimateMessageTokens: estimateTokens,
    });
    expect(plan.status).toBe('planned');
    if (plan.status !== 'planned') return;
    expect(plan.plan.summarizedMessages).toEqual([user('e1', 'a').message, assistant('e2', 'b').message]);
    expect(plan.plan.coveredUntilEntryId).toBe('e2');
    expect(plan.plan.firstKeptEntryId).toBe('e3');
    // User 3 is the extra message kept because of the Turn move.
    expect(plan.plan.turnPrefixMessages).toEqual([user('e3', 'c').message]);
  });

  it('moves a mid-Turn cut across multiple ordinary Turns into the correct Turn Prefix', () => {
    const sources = [
      user('e1', 'a'),
      assistant('e2', 'b'),
      user('e3', 'c'),
      assistant('e4', 'd'),
      user('e5', 'e'),
      assistant('e6', 'f'),
    ];
    const plan = planCompaction({
      sources,
      policy: { ...DEFAULT_COMPACTION_POLICY, keepRecentTokens: 1, minimumRecentMessages: 3 },
      estimateMessageTokens: estimateTokens,
    });
    expect(plan.status).toBe('planned');
    if (plan.status !== 'planned') return;
    // The budget cut lands on Assistant 4; the final cut moves to User 3.
    expect(plan.plan.summarizedMessages).toEqual([user('e1', 'a').message, assistant('e2', 'b').message]);
    expect(plan.plan.coveredUntilEntryId).toBe('e2');
    expect(plan.plan.firstKeptEntryId).toBe('e3');
    expect(plan.plan.turnPrefixMessages).toEqual([user('e3', 'c').message]);
  });

  it('keeps the whole Turn when its UserMessage is the first compactable entry', () => {
    // Moving the cut to User 1 would leave no summarized prefix: nothing is compacted.
    const sources = [
      user('e1', 'a'),
      assistant('e2', 'b'),
    ];
    const plan = planCompaction({
      sources,
      policy: { ...DEFAULT_COMPACTION_POLICY, keepRecentTokens: 1, minimumRecentMessages: 1 },
      estimateMessageTokens: estimateTokens,
    });
    expect(plan).toEqual({ status: 'nothing_to_compact', reason: 'no_older_messages' });
  });

  it('keeps ToolCall and ToolResult together inside the last Turn', () => {
    const sources = [
      user('e1', 'a'),
      assistant('e2', 'b'),
      user('e3', 'c'),
      assistant('e4', 'call', 'call:1'),
      toolResult('e5', 'call:1'),
      user('e6', 'd'),
      assistant('e7', 'e'),
    ];
    const plan = planCompaction({
      sources,
      policy: { ...DEFAULT_COMPACTION_POLICY, keepRecentTokens: 1, minimumRecentMessages: 3 },
      estimateMessageTokens: estimateTokens,
    });
    expect(plan.status).toBe('planned');
    if (plan.status !== 'planned') return;
    // The budget cut lands on the ToolResult; tool closure moves it to the
    // ToolCall and Turn closure then to User 3, keeping the loop closed.
    expect(plan.plan.summarizedMessages).toEqual([user('e1', 'a').message, assistant('e2', 'b').message]);
    expect(plan.plan.coveredUntilEntryId).toBe('e2');
    expect(plan.plan.firstKeptEntryId).toBe('e3');
    expect(plan.plan.turnPrefixMessages).toEqual([
      user('e3', 'c').message,
      assistant('e4', 'call', 'call:1').message,
    ]);
    // Neither the ToolCall nor its ToolResult enters the Summary.
    const summarized = plan.plan.summarizedMessages;
    expect(summarized.some((message) => message.role === 'toolResult')).toBe(false);
    expect(JSON.stringify(summarized)).not.toContain('call:1');
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

  it('keeps the two pre-execution empty outcomes distinct', () => {
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
  });
});
