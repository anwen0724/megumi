/* Verifies rolling Summary requests preserve prior Summary, Turn Prefix and exact facts. */
import { describe, expect, it, vi } from 'vitest';
import type { Message, Models } from '@megumi/ai';
import {
  buildCompactionSummaryRequest,
  COMPACTION_SUMMARY_SYSTEM_PROMPT,
  generateCompactionSummary,
} from '../../../packages/context/src/compaction/compaction-summary-generator';
import { model } from './context-test-fixtures';

const conversation: Message[] = [
  {
    role: 'user',
    content: [
      { type: 'text', text: 'task with /workspace/report.pdf' },
      { type: 'image', data: 'binary', mimeType: 'image/png' },
    ],
    timestamp: 0,
  },
  {
    role: 'assistant',
    content: [{ type: 'toolCall', id: 'call:1', name: 'read_file', arguments: { path: '/workspace/report.pdf' } }],
    api: 'openai-completions',
    provider: 'openai',
    model: 'gpt',
    stopReason: 'toolUse',
    usage: {
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    timestamp: 0,
  },
];

const turnPrefix: Message[] = [
  {
    role: 'assistant',
    content: [{ type: 'toolCall', id: 'call:2', name: 'read_file', arguments: { path: '/workspace/next.md' } }],
    api: 'openai-completions',
    provider: 'openai',
    model: 'gpt',
    stopReason: 'toolUse',
    usage: {
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    timestamp: 1,
  },
  {
    role: 'toolResult',
    toolCallId: 'call:2',
    toolName: 'read_file',
    content: [{ type: 'text', text: 'kept in the prompt' }],
    isError: false,
    timestamp: 2,
  },
];

describe('buildCompactionSummaryRequest', () => {
  it('expresses Previous Summary, replaced history and Turn Prefix separately', () => {
    const request = buildCompactionSummaryRequest({
      previousSummary: 'old facts',
      messages: conversation,
      turnPrefixMessages: turnPrefix,
    });
    expect(request.systemPrompt).toBe(COMPACTION_SUMMARY_SYSTEM_PROMPT);
    expect(request.input).toContain('<previous_summary>');
    expect(request.input).toContain('old facts');
    expect(request.input).toContain('<conversation>');
    expect(request.input).toContain('/workspace/report.pdf');
    expect(request.input).toContain('<current_turn_prefix>');
    // The Turn Prefix actually reaches the model request, not a boolean flag.
    expect(request.input).toContain('/workspace/next.md');
    expect(request.input).toContain('kept in the prompt');
    expect(request.input).toContain('Image attachment included as structured content below');
    expect(request.input).not.toContain('binary');
  });

  it('omits the Turn Prefix section when the cut lands on a Turn boundary', () => {
    const request = buildCompactionSummaryRequest({ previousSummary: 'old facts', messages: conversation });
    expect(request.input).not.toContain('<current_turn_prefix>');
    expect(request.input).toContain('<conversation>');
  });
});

describe('generateCompactionSummary', () => {
  const summaryInput = {
    model,
    sessionId: 'session:1',
    previousSummary: 'old facts',
    messages: conversation,
    turnPrefixMessages: turnPrefix,
    timestamp: 1_000,
  };

  it('feeds the Turn Prefix into the model request', async () => {
    const completeSimple = vi.fn(async (_model: unknown, _request: unknown, _options: unknown) => ({
      content: [{ type: 'text', text: 'new summary' }],
      stopReason: 'stop' as const,
    }));
    await generateCompactionSummary({
      models: { completeSimple } as unknown as Pick<Models, 'completeSimple'>,
      ...summaryInput,
    });
    const request = completeSimple.mock.calls[0]![1] as { messages: Array<{ content: string }> };
    expect(request.messages[0]!.content).toContain('<current_turn_prefix>');
    expect(request.messages[0]!.content).toContain('/workspace/next.md');
  });

  it('returns the generated text with its Usage', async () => {
    const completeSimple = vi.fn(async () => ({
      content: [{ type: 'text', text: 'new summary' }],
      stopReason: 'stop' as const,
      usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    }));
    const result = await generateCompactionSummary({
      models: { completeSimple } as unknown as Pick<Models, 'completeSimple'>,
      ...summaryInput,
    });
    expect(result).toMatchObject({ status: 'generated', content: 'new summary', usage: { totalTokens: 15 } });
  });

  it('keeps empty results, errors and length failures as stable failures', async () => {
    const empty = await generateCompactionSummary({
      models: { completeSimple: vi.fn(async () => ({ content: [], stopReason: 'stop' as const })) } as unknown as Pick<Models, 'completeSimple'>,
      ...summaryInput,
    });
    expect(empty.status).toBe('failed');

    const errored = await generateCompactionSummary({
      models: { completeSimple: vi.fn(async () => ({
        content: [], stopReason: 'error' as const, errorMessage: 'provider error',
      })) } as unknown as Pick<Models, 'completeSimple'>,
      ...summaryInput,
    });
    expect(errored).toEqual({ status: 'failed', failure: 'provider error' });

    const truncated = await generateCompactionSummary({
      models: { completeSimple: vi.fn(async () => ({ content: [], stopReason: 'length' as const })) } as unknown as Pick<Models, 'completeSimple'>,
      ...summaryInput,
    });
    expect(truncated.status).toBe('failed');
  });

  it('keeps cancellation distinct from model failures', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await generateCompactionSummary({
      models: { completeSimple: vi.fn(async () => ({ content: [], stopReason: 'stop' as const })) } as unknown as Pick<Models, 'completeSimple'>,
      ...summaryInput,
      signal: controller.signal,
    });
    expect(result).toEqual({ status: 'cancelled' });
  });
});
