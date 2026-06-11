import type { ProviderId } from '@megumi/shared/provider';
import { createAnthropicAdapter } from './providers/anthropic';
import { createDeepSeekAdapter } from './providers/deepseek';
import { createOpenAIAdapter } from './providers/openai';
import type { AiProviderAdapter, Clock, FetchLike } from './types';

export interface AiProviderRegistryOptions {
  fetch?: FetchLike;
  clock?: Clock;
}

export class AiProviderRegistry {
  private readonly adapters: Map<ProviderId, AiProviderAdapter>;

  constructor(adapters: AiProviderAdapter[]) {
    this.adapters = new Map(adapters.map((adapter) => [adapter.providerId, adapter]));
  }

  listProviderIds(): ProviderId[] {
    return (['deepseek', 'openai', 'anthropic'] as const).filter((providerId) => this.adapters.has(providerId));
  }

  getAdapter(providerId: ProviderId): AiProviderAdapter {
    const adapter = this.adapters.get(providerId);

    if (!adapter) {
      throw new Error(`AI provider adapter is not registered: ${providerId}`);
    }

    return adapter;
  }
}

export function createAiProviderRegistry(options: AiProviderRegistryOptions = {}): AiProviderRegistry {
  const fetchImpl = options.fetch ?? fetch;

  return new AiProviderRegistry([
    createDeepSeekAdapter({ fetch: fetchImpl, clock: options.clock }),
    createOpenAIAdapter({ fetch: fetchImpl, clock: options.clock }),
    createAnthropicAdapter({ clock: options.clock }),
  ]);
}

