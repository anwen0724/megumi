// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  ProviderRegistry,
  createDeepSeekProviderAdapter,
  createOpenAIProviderAdapter,
  type FetchLike,
} from '@megumi/ai';

function sseResponse(): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('pure AI provider registry', () => {
  it('only registers provider adapters explicitly supplied by the caller', () => {
    const registry = new ProviderRegistry([
      createOpenAIProviderAdapter({
        baseUrl: 'https://proxy.local/openai',
        fetch: vi.fn<FetchLike>(),
      }),
    ]);

    expect(registry.listProviderIds()).toEqual(['openai']);
    expect(registry.get('openai').providerId).toBe('openai');
    expect(() => registry.get('deepseek')).toThrow('AI provider adapter is not registered: deepseek');
  });

  it('throws a typed registry error for unknown providers', () => {
    const registry = new ProviderRegistry([]);

    expect(() => registry.get('missing')).toThrow('AI provider adapter is not registered: missing');
  });

  it('does not expose a default provider registry from the AI package', async () => {
    const ai = await import('@megumi/ai');

    expect('createDefaultProviderRegistry' in ai).toBe(false);
    expect(existsSync(join(process.cwd(), 'packages/ai/providers/default-provider-registry.ts'))).toBe(false);
  });

  it('requires explicit provider base URLs for named provider adapters', async () => {
    const openAiFetch = vi.fn<FetchLike>().mockResolvedValue(sseResponse());
    const deepSeekFetch = vi.fn<FetchLike>().mockResolvedValue(sseResponse());

    await collect(createOpenAIProviderAdapter({
      baseUrl: 'https://proxy.local/openai',
      fetch: openAiFetch,
    }).stream(request('openai', 'gpt-5.5')));

    await collect(createDeepSeekProviderAdapter({
      baseUrl: 'https://proxy.local/deepseek',
      fetch: deepSeekFetch,
    }).stream(request('deepseek', 'deepseek-v4-pro')));

    expect(openAiFetch.mock.calls[0][0]).toBe('https://proxy.local/openai/chat/completions');
    expect(deepSeekFetch.mock.calls[0][0]).toBe('https://proxy.local/deepseek/chat/completions');
  });
});

function request(providerId: string, modelId: string) {
  return {
    model: {
      providerId,
      modelId,
    },
    context: {
      messages: [
        { role: 'user' as const, content: 'Hello' },
      ],
    },
    credential: { type: 'api_key' as const, value: 'sk-test' },
  };
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const output: T[] = [];
  for await (const event of events) {
    output.push(event);
  }
  return output;
}
