// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createProviderRegistry, type FetchLike } from '@megumi/ai';

describe('pure AI provider registry', () => {
  it('registers DeepSeek, OpenAI, and Anthropic provider adapters', () => {
    const registry = createProviderRegistry({
      fetch: vi.fn<FetchLike>(),
    });

    expect(registry.listProviderIds()).toEqual(['anthropic', 'deepseek', 'openai']);
    expect(registry.get('deepseek').providerId).toBe('deepseek');
    expect(registry.get('openai').providerId).toBe('openai');
    expect(registry.get('anthropic').providerId).toBe('anthropic');
  });

  it('throws a typed registry error for unknown providers', () => {
    const registry = createProviderRegistry({
      fetch: vi.fn<FetchLike>(),
    });

    expect(() => registry.get('missing')).toThrow('AI provider adapter is not registered: missing');
  });
});
