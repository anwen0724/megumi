// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  ProtocolRegistry,
  createOpenAICompatibleProtocolAdapter,
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

describe('pure AI protocol registry', () => {
  it('only registers protocol adapters explicitly supplied by the caller', () => {
    const registry = new ProtocolRegistry([
      createOpenAICompatibleProtocolAdapter({
        fetch: vi.fn<FetchLike>(),
      }),
    ]);

    expect(registry.listProtocols()).toEqual(['openai-compatible']);
    expect(registry.get('openai-compatible').protocol).toBe('openai-compatible');
    expect(() => registry.get('anthropic')).toThrow('AI protocol adapter is not registered: anthropic');
  });

  it('throws a typed registry error for unknown protocols', () => {
    const registry = new ProtocolRegistry([]);

    expect(() => registry.get('missing')).toThrow('AI protocol adapter is not registered: missing');
  });

  it('does not expose built-in provider registries or named provider adapters from the AI package', async () => {
    const ai = await import('@megumi/ai');

    expect('createDefaultProviderRegistry' in ai).toBe(false);
    expect('createOpenAIProviderAdapter' in ai).toBe(false);
    expect('createDeepSeekProviderAdapter' in ai).toBe(false);
    expect(existsSync(join(process.cwd(), 'packages/ai/providers/default-provider-registry.ts'))).toBe(false);
  });

  it('uses each configured provider instance base URL through the shared protocol adapter', async () => {
    const openAiFetch = vi.fn<FetchLike>().mockResolvedValue(sseResponse());
    const deepSeekFetch = vi.fn<FetchLike>().mockResolvedValue(sseResponse());
    const adapter = createOpenAICompatibleProtocolAdapter({ fetch: openAiFetch });

    await collect(adapter.stream(request('openai', 'gpt-5.5', 'https://proxy.local/openai')));

    await collect(createOpenAICompatibleProtocolAdapter({ fetch: deepSeekFetch })
      .stream(request('deepseek', 'deepseek-v4-pro', 'https://proxy.local/deepseek')));

    expect(openAiFetch.mock.calls[0][0]).toBe('https://proxy.local/openai/chat/completions');
    expect(deepSeekFetch.mock.calls[0][0]).toBe('https://proxy.local/deepseek/chat/completions');
  });
});

function request(providerId: string, modelId: string, baseUrl: string) {
  return {
    model: {
      providerId,
      protocol: 'openai-compatible' as const,
      modelId,
      baseUrl,
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
