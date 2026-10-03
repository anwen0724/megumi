/* Verifies provider diagnostics through real AI protocol parsing and journal capture. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Model } from '@megumi/ai';
import { openAICompletionsApi } from '@megumi/ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@megumi/ai/api/openai-responses.lazy';
import { openAICodexResponsesApi } from '@megumi/ai/api/openai-codex-responses.lazy';
import { anthropicMessagesApi } from '@megumi/ai/api/anthropic-messages.lazy';
import { createProviderCapture } from '@megumi/application/observability/provider-capture';
import { createTraceRecorder } from '@megumi/application/observability/trace/trace-recorder';
import type { TraceJournalRecord } from '@megumi/application/observability/persistence/trace-journal-record';

const model: Model<'openai-completions'> = {
  id: 'test', name: 'Test', api: 'openai-completions', provider: 'openai',
  baseUrl: 'https://example.test/v1', reasoning: false, input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 4096, maxTokens: 512,
};

describe('Provider capture', () => {
  it('records each real request and retry without storing stream fragments or a second model reply', async () => {
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
      return response;
    }));
    expect(result.stopReason).toBe('stop');
    expect(result.content).toEqual([expect.objectContaining({ type: 'text', text: 'Hello back' })]);
    expect(requests).toBe(2);
    const content = records.filter((record) => record.type === 'content.recorded');
    expect(content.map((record) => record.kind)).toEqual(['model.provider_request', 'model.provider_request']);
    expect(content.map((record) => record.correlation.providerAttempt)).toEqual([1, 2]);
    expect(records.filter((record) => record.type === 'span.event').map((record) => record.event)).toEqual([
      { type: 'model.retry.scheduled', currentAttempt: 1, nextAttempt: 2, reasonCode: 'http_429' },
      { type: 'model.output.started', providerAttempt: 2 },
    ]);
    expect(content.every((record) => record.correlation.modelCallId === 'model:1')).toBe(true);
  });

  it.each([
    { api: 'openai-completions', streams: openAICompletionsApi(), events: [
      { id: 'reply:1', choices: [{ index: 0, delta: { content: 'Partial reply' } }] },
    ] },
    { api: 'openai-responses', streams: openAIResponsesApi(), events: partialResponsesEvents() },
    { api: 'openai-codex-responses', streams: openAICodexResponsesApi(), events: partialResponsesEvents() },
    { api: 'anthropic-messages', streams: anthropicMessagesApi(), events: [
      { type: 'message_start', message: { id: 'reply:1', usage: { input_tokens: 1, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Partial reply' } },
    ] },
  ])('retains the partial reply and interruption boundary for $api', async ({ api, streams, events }) => {
    const records: TraceJournalRecord[] = [];
    const observability = createTraceRecorder({ enqueue: record => { records.push(record); } });
    const fetch: typeof globalThis.fetch = async () => new Response(
      events.map(event => `event: ${'type' in event ? event.type : 'message'}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
      { headers: { 'content-type': 'text/event-stream' } },
    );
    const account = Buffer.from(JSON.stringify({
      'https://api.openai.com/auth': { chatgpt_account_id: 'test-account' },
    })).toString('base64');
    const result = await observability.withTrace({ kind: 'conversation' }, () =>
      observability.withSpan({ name: 'model.call' }, async () => {
        const capture = createProviderCapture({ observability, correlation: { modelCallId: 'model:1' }, fetch });
        return streams.streamSimple({ ...model, api }, {
          messages: [{ role: 'user', content: 'Hello', timestamp: 0 }],
        }, { ...capture.options, apiKey: `test.${account}.test`, transport: 'sse', maxRetries: 0 }).result();
      }),
    );
    expect(result).toMatchObject({ stopReason: 'error', content: [
      expect.objectContaining({ type: 'text', text: 'Partial reply' }),
    ] });
    expect(records.filter(record => record.type === 'content.recorded').map(record => record.kind))
      .toEqual(['model.provider_request']);
    expect(records.filter(record => record.type === 'span.event').map(record => record.event)).toEqual([
      { type: 'model.output.started', providerAttempt: 1 },
      { type: 'model.stream.interrupted', providerAttempt: 1, reasonCode: 'stream_error' },
    ]);
  });
});

/** Ends after visible output, before the Responses protocol's required terminal event. */
function partialResponsesEvents() {
  return [
    { type: 'response.created', response: { id: 'reply:1' } },
    { type: 'response.output_item.added', output_index: 0,
      item: { type: 'message', id: 'message:1', role: 'assistant', content: [] } },
    { type: 'response.content_part.added', output_index: 0, content_index: 0,
      part: { type: 'output_text', text: '', annotations: [] } },
    { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'Partial reply' },
  ];
}

/** Emits a provider response at the network boundary; parsing remains real. */
function replyResponse(): Response {
  return new Response(`data: ${JSON.stringify({
    id: 'response:1', object: 'chat.completion.chunk', created: 1, model: 'test',
    choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello back' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
}
