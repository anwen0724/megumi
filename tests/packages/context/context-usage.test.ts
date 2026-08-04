/* Verifies Usage is derived from Session History with provider-reported baselines. */
import type { Api, Model } from '@megumi/ai';
import { describe, expect, it } from 'vitest';
import { deriveContextUsage } from '../../../packages/context/src/index';
import type { SessionHistoryItem } from '@megumi/session';

const model: Model<Api> = {
  id: 'gpt',
  name: 'GPT',
  api: 'openai-completions',
  provider: 'openai',
  baseUrl: 'https://api.example.com/v1',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1000,
  maxTokens: 100,
};

const usage = (input: number, output: number) => ({
  input,
  output,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: input + output,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

function history(): SessionHistoryItem[] {
  return [
    {
      type: 'message',
      entry: { entry_id: 'e1', session_id: 's', entry_type: 'message', message_id: 'm1', created_at: 'now' },
      message: {
        message_id: 'm1', session_id: 's', run_id: 'r1', message_kind: 'user_message',
        display_content: [{ type: 'text', text: 'task' }],
        model_content: [{ type: 'text', text: 'task' }],
        created_at: 'now',
      },
      attachments: [],
    },
    {
      type: 'message',
      entry: { entry_id: 'e2', session_id: 's', entry_type: 'message', message_id: 'm2', created_at: 'now' },
      message: {
        message_id: 'm2', session_id: 's', run_id: 'r1', message_kind: 'model_response',
        content: [{ type: 'text', text: 'answer' }],
        outcome_status: 'completed',
        stop_reason: 'stop',
        api: 'openai-completions', provider: 'openai', model: 'gpt',
        usage: usage(300, 100),
        created_at: 'now',
      },
      attachments: [],
    },
  ];
}

describe('deriveContextUsage', () => {
  it('uses the valid Assistant Usage as the baseline and sums cumulative facts', () => {
    const derived = deriveContextUsage({ history: history(), model });
    expect(derived).toMatchObject({
      usageTokens: 400,
      accuracy: 'provider_reported',
      contextWindowTokens: 1000,
      cumulativeInputTokens: 300,
      cumulativeOutputTokens: 100,
      cumulativeCost: 0,
    });
    expect(derived.totalTokens).toBeGreaterThanOrEqual(derived.usageTokens);
  });

  it('estimates the whole Prompt when no valid Usage exists', () => {
    const item = history()[1]! as Extract<SessionHistoryItem, { type: 'message' }>;
    const noUsage = { ...item, message: { ...item.message, usage: undefined } };
    const derived = deriveContextUsage({ history: [noUsage], model });
    expect(derived.accuracy).toBe('estimated');
    expect(derived.usageTokens).toBe(derived.totalTokens);
  });

  it('never treats a legacy record without usage as a provider baseline', () => {
    const item = history()[1]! as Extract<SessionHistoryItem, { type: 'message' }>;
    const legacy = {
      ...item,
      message: {
        ...item.message,
        api: undefined as never,
        provider: undefined as never,
        model: undefined as never,
        usage: undefined as never,
      },
    };
    const derived = deriveContextUsage({ history: [history()[0]!, legacy], model });
    expect(derived.accuracy).toBe('estimated');
    expect(derived.cumulativeInputTokens).toBe(0);
  });

  it('includes Compaction Summary Usage in the cumulative totals', () => {
    const items = history();
    const withCompaction: SessionHistoryItem[] = [
      ...items,
      {
        type: 'compaction',
        entry: {
          entry_id: 'e3', session_id: 's', entry_type: 'compaction',
          compaction_id: 'c1', created_at: 'now',
        },
        compaction: {
          compaction_id: 'c1', session_id: 's', summary_text: 'summary',
          covered_until_entry_id: 'e2', usage: usage(50, 10), created_at: 'now',
        },
      },
    ];
    const derived = deriveContextUsage({ history: withCompaction, model });
    expect(derived.cumulativeInputTokens).toBe(300 + 50);
    expect(derived.cumulativeOutputTokens).toBe(100 + 10);
    // The Summary Usage is never a baseline for the next Prompt estimate.
    expect(derived.accuracy).toBe('provider_reported');
  });
});
