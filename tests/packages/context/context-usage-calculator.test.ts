/* Verifies Usage: full-Prompt calculation and Session-derived display usage. */
import type { Api, Model } from '@megumi/ai';
import { estimateMessageTokens, estimateTextTokens } from '@megumi/ai/utils/estimate';
import { describe, expect, it, vi } from 'vitest';
import { deriveContextUsage } from '../../../packages/context/src/index';
import { calculatePromptUsage } from '../../../packages/context/src/context-usage-calculator';
import type { Prompt } from '../../../packages/context/src/index';
import type { SessionHistoryItem } from '@megumi/session';
import type { ToolDefinition } from '@megumi/tools';

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

const readFileTool: ToolDefinition = {
  name: 'read_file',
  description: 'Read a file',
  parameters: { type: 'object' },
};

/** Full Prompt without any provider-reported Usage baseline. */
function promptWithoutBaseline(): Prompt {
  return {
    systemPrompt: 'system prompt',
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'task' }], timestamp: 1 },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'answer' }],
        api: 'openai-completions',
        provider: 'openai',
        model: 'gpt',
        usage: usage(0, 0),
        stopReason: 'stop',
        timestamp: 2,
      },
    ],
    tools: [readFileTool],
  };
}

describe('calculatePromptUsage', () => {
  it('counts System Prompt, Messages and Tool Definitions without a provider baseline', () => {
    const prompt = promptWithoutBaseline();
    const result = calculatePromptUsage({ prompt });
    // The default path estimates the complete Prompt: systemPrompt + messages + tools.
    const expected = estimateTextTokens(prompt.systemPrompt)
      + prompt.messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0)
      + estimateTextTokens(JSON.stringify(prompt.tools));
    expect(result.tokens).toBe(expected);
    expect(result.usageTokens).toBe(0);
    expect(result.trailingTokens).toBe(result.tokens);
    // The System Prompt and Tools are inside the estimate, not only the messages.
    expect(result.tokens).toBeGreaterThan(estimateMessageTokens(prompt.messages[0]!)
      + estimateMessageTokens(prompt.messages[1]!));
  });

  it('passes the complete Prompt to a custom estimator', () => {
    const estimator = vi.fn(() => 42);
    const prompt = promptWithoutBaseline();
    const result = calculatePromptUsage({ prompt, estimator });
    expect(estimator).toHaveBeenCalledTimes(1);
    expect(estimator).toHaveBeenCalledWith(prompt);
    expect(result).toMatchObject({ tokens: 42, usageTokens: 0, trailingTokens: 42 });
  });

  it('respects the AI estimator semantics when a provider Usage baseline exists', () => {
    const prompt: Prompt = {
      systemPrompt: 'system prompt that was already part of the baseline prefix',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'task' }], timestamp: 1 },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'answer' }],
          api: 'openai-completions',
          provider: 'openai',
          model: 'gpt',
          usage: usage(300, 100),
          stopReason: 'stop',
          timestamp: 2,
        },
        {
          role: 'toolResult',
          toolCallId: 'call:1',
          toolName: 'read_file',
          content: [{ type: 'text', text: 'ok' }],
          addedToolNames: ['read_file'],
          isError: false,
          timestamp: 3,
        },
      ],
      tools: [readFileTool],
    };
    const result = calculatePromptUsage({ prompt });
    // The baseline covers the already-computed prefix (System Prompt included);
    // only the trailing message and the newly-added Tool are estimated.
    expect(result.usageTokens).toBe(400);
    expect(result.tokens).toBeGreaterThan(400);
    expect(result.tokens).toBe(result.usageTokens + result.trailingTokens);
    expect(result.trailingTokens).toBeGreaterThan(estimateMessageTokens(prompt.messages[2]!));
  });
});

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
