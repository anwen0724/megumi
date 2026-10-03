/* Verifies Usage: full-Prompt calculation and Session-derived display usage. */
import type { Api, Model } from '@megumi/ai';
import { describe, expect, it, vi } from 'vitest';
import { calculatePromptUsage } from '@megumi/agent/context/context-budget';
import type { PreparedContext as Prompt } from '@megumi/agent';
import type { SessionHistoryItem } from '@megumi/application/coding/sessions/session-branches';
import type { ToolDefinition } from '@megumi/agent/tools/tool-contracts';

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
    // Known fixture: 4 system + 3 message + 21 tool tokens at four chars/token.
    expect(result.tokens).toBe(28);
    expect(result.usageTokens).toBe(0);
    expect(result.trailingTokens).toBe(result.tokens);
    // The System Prompt and Tools are inside the estimate, not only the messages.
    expect(result.tokens).toBeGreaterThan(3);
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
          isError: false,
          timestamp: 3,
        },
        { role: 'system', content: '', toolsAdded: [readFileTool], timestamp: 3 },
      ],
      tools: [readFileTool],
    };
    const result = calculatePromptUsage({ prompt });
    // The baseline covers the already-computed prefix (System Prompt included);
    // only the trailing message and the newly-added Tool are estimated.
    expect(result.usageTokens).toBe(400);
    expect(result.tokens).toBeGreaterThan(400);
    expect(result.tokens).toBe(result.usageTokens + result.trailingTokens);
    expect(result.trailingTokens).toBe(22);
  });
});
