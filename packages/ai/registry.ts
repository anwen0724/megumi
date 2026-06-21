// Registry for pure AI provider adapters.
import { AiRegistryError } from './errors';
import { type ProviderAdapter } from './provider';
import { createAnthropicProviderAdapter } from './providers/anthropic';
import { createDeepSeekProviderAdapter } from './providers/deepseek';
import { createOpenAIProviderAdapter } from './providers/openai';
import { type FetchLike } from './providers/openai-compatible';

export interface ProviderRegistryOptions {
  fetch?: FetchLike;
}

export class ProviderRegistry {
  private readonly adapters: Map<string, ProviderAdapter>;

  constructor(adapters: ProviderAdapter[]) {
    this.adapters = new Map(adapters.map((adapter) => [adapter.providerId, adapter]));
  }

  listProviderIds(): string[] {
    return Array.from(this.adapters.keys()).sort();
  }

  get(providerId: string): ProviderAdapter {
    const adapter = this.adapters.get(providerId);

    if (!adapter) {
      throw new AiRegistryError(`AI provider adapter is not registered: ${providerId}`);
    }

    return adapter;
  }
}

export function createProviderRegistry(options: ProviderRegistryOptions = {}): ProviderRegistry {
  const fetchImpl = options.fetch ?? fetch;

  return new ProviderRegistry([
    createDeepSeekProviderAdapter({ fetch: fetchImpl }),
    createOpenAIProviderAdapter({ fetch: fetchImpl }),
    createAnthropicProviderAdapter(),
  ]);
}
