/* Verifies provider diagnostics through real AI protocol parsing and journal capture. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Model } from '@megumi/ai';
import { openAICompletionsApi } from '@megumi/ai/api/openai-completions.lazy';
import { createProviderCapture } from '@megumi/application/observability/provider-capture';
import { createTraceRecorder } from '@megumi/application/observability/trace/trace-recorder';
import type { TraceJournalRecord } from '@megumi/application/observability/persistence/trace-journal-record';

const model: Model<'openai-completions'> = {
  id: 'test', name: 'Test', api: 'openai-completions', provider: 'openai',
  baseUrl: 'https://example.test/v1', reasoning: false, input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 4096, maxTokens: 512,
};

describe('Provider capture', () => {
  it('retains actual HTTP attempts and raw provider events across a retry without changing the reply', async () => {
    const records: TraceJournalRecord[] = [];
    const observability = createTraceRecorder({ enqueue: (record) => { records.push(record); } });
    let requests = 0;
    const fetch: typeof globalThis.fetch = async () => {
      requests++;
      if (requests === 1) return new Response('{"error":{"message":"Rate limited"}}', {
        status: 429, headers: { 'content-type': 'application/json', 'retry-after-ms': '1' },
      });
      return replyResponse();
    };
    const result = await observability.withTrace({ kind: 'conversation' }, () => observability.withSpan({ name: 'model.call' }, async () => {
      const capture = createProviderCapture({ observability, correlation: { modelCallId: 'model:1' }, fetch });
      const stream = openAICompletionsApi().streamSimple(model, {
        messages: [{ role: 'user', content: 'Hello', timestamp: 0 }],
      }, { ...capture.options, apiKey: 'test-key', maxRetries: 1 });
      const response = await stream.result();
      capture.complete(response);
      return response;
    }));
    expect(result.stopReason).toBe('stop');
    expect(result.content).toEqual([expect.objectContaining({ type: 'text', text: 'Hello back' })]);
    expect(requests).toBe(2);
    const content = records.filter((record) => record.type === 'content.recorded');
    expect(content.filter((record) => record.kind === 'model.provider_request'
      && record.correlation.providerAttempt !== undefined).map((record) => record.correlation.providerAttempt)).toEqual([1, 2]);
    expect(content.filter((record) => record.kind === 'model.provider_response').map((record) =>
      record.content.mode === 'inline' ? record.content.value : undefined,
    )).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 429 }), expect.objectContaining({ status: 200 }),
    ]));
    expect(content.some((record) => record.kind === 'model.provider_event'
      && record.content.mode === 'inline'
      && JSON.stringify(record.content.value).includes('Hello back'))).toBe(true);
    expect(records.filter((record) => record.type === 'span.event').map((record) => record.event)).toContainEqual({
      type: 'model.retry.started', currentAttempt: 1, nextAttempt: 2, reasonCode: 'http_429',
    });
    expect(content.every((record) => record.correlation.modelCallId === 'model:1')).toBe(true);
  });
});

/** Emits a provider response at the network boundary; parsing remains real. */
function replyResponse(): Response {
  return new Response(`data: ${JSON.stringify({
    id: 'response:1', object: 'chat.completion.chunk', created: 1, model: 'test',
    choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello back' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
}
