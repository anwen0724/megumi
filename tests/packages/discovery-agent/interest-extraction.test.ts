/* Verifies the provider-neutral Interest extraction model request and strict JSON result. */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { Api, Model } from '@megumi/ai';
import { createInterestExtractor } from '@megumi/discovery-agent';

const model = {
  id: 'test-model',
  name: 'Test',
  api: 'test-api',
  provider: 'test-provider',
  baseUrl: 'https://example.invalid',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8_192,
  maxTokens: 1_024,
} as Model<Api>;

describe('Interest extractor', () => {
  it('provides only the user turn, reference reply, and current Interest facts and parses JSON', async () => {
    const completeSimple = vi.fn(async () => ({
      stopReason: 'stop',
      content: [{
        type: 'text',
        text: '```json\n{"evidence":[{"description":"Agent 工程化","effect":"support","confidence":"high"}]}\n```',
      }],
    } as any));
    const extractor = createInterestExtractor({ models: { completeSimple } });

    await expect(extractor.extract(input())).resolves.toEqual({
      evidence: [{ description: 'Agent 工程化', effect: 'support', confidence: 'high' }],
    });
    const context = completeSimple.mock.calls[0]![1];
    expect(context.systemPrompt).toContain('Evidence belongs only to the user message');
    expect(context.messages[0]?.content).toContain('我想持续关注 Agent 工程化');
    expect(context.messages[0]?.content).toContain('assistantReplyForReferenceOnly');
  });

  it('rejects invalid model JSON instead of persisting a partial interpretation', async () => {
    const extractor = createInterestExtractor({
      models: {
        completeSimple: async () => ({
          stopReason: 'stop',
          content: [{ type: 'text', text: '{"evidence":[{"confidence":"certain"}]}' }],
        } as any),
      },
    });
    await expect(extractor.extract(input())).rejects.toThrow();
  });
});

function input() {
  return {
    job: {
      sessionId: 'session:1',
      executionId: 'execution:1',
      userMessageId: 'user:1',
      assistantMessageId: 'assistant:1',
      completedAt: '2026-08-22T10:00:00.000Z',
      sequence: 1,
    },
    userText: '我想持续关注 Agent 工程化',
    assistantText: '好的，我会留意。',
    interests: [],
    pendingEvidence: [],
    model,
    signal: new AbortController().signal,
  };
}
