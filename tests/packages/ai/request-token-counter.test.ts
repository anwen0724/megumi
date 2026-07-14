/*
 * Verifies side-effect-free request materialization and conservative token counting.
 */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  createOpenAICompatibleProtocolAdapter,
  createAnthropicProtocolAdapter,
  createRequestTokenCounter,
  ProtocolRegistry,
  type AiCallRequest,
  type FetchLike,
} from '@megumi/ai';

describe('RequestTokenCounter', () => {
  it('counts the exact OpenAI-compatible body used by streaming without network access', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(new Response(
      'data: {"choices":[]}\n\ndata: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } },
    ));
    const adapter = createOpenAICompatibleProtocolAdapter({ fetch });
    const registry = new ProtocolRegistry([adapter]);
    const counter = createRequestTokenCounter(registry);
    const request = completeRequest();

    const materialized = adapter.materialize!(request);
    const counted = await counter.count(request);

    expect(fetch).not.toHaveBeenCalled();
    expect(materialized).toEqual({
      model: 'model-1',
      messages: [
        { role: 'system', content: 'Instructions' },
        {
          role: 'user',
          content: '{"type":"reference_context","kind":"skill_catalog","content":[{"skillId":"skill-1","description":"Catalog entry"}]}',
        },
        {
          role: 'user',
          content: '{"type":"reference_context","kind":"memory_recall","content":[{"type":"text","text":"Memory"}]}',
        },
        { role: 'user', content: 'Conversation' },
      ],
      stream: true,
      stream_options: { include_usage: true },
      tools: [{
        type: 'function',
        function: {
          name: 'lookup',
          description: 'Reference a record',
          parameters: { type: 'object', properties: { id: { type: 'number' } } },
        },
      }],
      tool_choice: 'auto',
    });
    expect(counted).toEqual({
      inputTokens: new TextEncoder().encode(JSON.stringify(materialized)).byteLength,
      accuracy: 'estimated',
    });

    await collect(adapter.stream(request));
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual(materialized);
  });

  it('counts the materialized Anthropic request without starting a stream', async () => {
    const adapter = createAnthropicProtocolAdapter();
    const stream = vi.spyOn(adapter, 'stream');
    const registry = new ProtocolRegistry([adapter]);
    const counter = createRequestTokenCounter(registry);
    const request = {
      ...completeRequest(),
      model: { providerId: 'p', protocol: 'anthropic' as const, modelId: 'm' },
    };

    const counted = await counter.count(request);
    const materialized = adapter.materialize!(request);

    expect(counted).toEqual({
      inputTokens: new TextEncoder().encode(JSON.stringify(materialized)).byteLength,
      accuracy: 'estimated',
    });
    expect(stream).not.toHaveBeenCalled();
  });
});

function completeRequest(): AiCallRequest {
  return {
    model: {
      providerId: 'provider-1',
      protocol: 'openai-compatible',
      modelId: 'model-1',
      baseUrl: 'https://example.test/v1',
    },
    context: {
      systemPrompt: 'Instructions',
      messages: [
        {
          role: 'context',
          kind: 'skill_catalog',
          content: [{ skillId: 'skill-1', description: 'Catalog entry' }],
        },
        {
          role: 'context',
          kind: 'memory_recall',
          content: [{ type: 'text', text: 'Memory' }],
        },
        { role: 'user', content: [{ type: 'text', text: 'Conversation' }] },
      ],
    },
    tools: [{
      name: 'lookup',
      description: 'Reference a record',
      inputSchema: { type: 'object', properties: { id: { type: 'number' } } },
    }],
  };
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const output: T[] = [];
  for await (const event of events) output.push(event);
  return output;
}
