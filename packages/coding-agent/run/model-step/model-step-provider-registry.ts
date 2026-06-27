// Runtime-shaped registry used by Coding Agent model steps to access provider adapters.
import type { ProviderId } from '@megumi/shared/provider';
import { createAiClient, createDefaultProviderRegistry, type CreateDefaultProviderRegistryOptions } from '@megumi/ai';
import { createModelStepProviderAdapter } from './model-step-provider-adapter';
import type { Clock, ModelStepProviderAdapter } from './model-step-types';

export interface ModelStepProviderRegistryOptions extends CreateDefaultProviderRegistryOptions {
  clock?: Clock;
}

export class ModelStepProviderRegistry {
  private readonly adapters: Map<ProviderId, ModelStepProviderAdapter>;

  constructor(adapters: ModelStepProviderAdapter[]) {
    this.adapters = new Map(adapters.map((adapter) => [adapter.providerId, adapter]));
  }

  listProviderIds(): ProviderId[] {
    return (['deepseek', 'openai', 'anthropic'] as const).filter((providerId) => this.adapters.has(providerId));
  }

  getAdapter(providerId: ProviderId): ModelStepProviderAdapter {
    const adapter = this.adapters.get(providerId);

    if (!adapter) {
      throw new Error(`AI provider adapter is not registered: ${providerId}`);
    }

    return adapter;
  }
}

export function createModelStepProviderRegistry(options: ModelStepProviderRegistryOptions = {}): ModelStepProviderRegistry {
  const aiClient = createAiClient({
    registry: createDefaultProviderRegistry({ fetch: options.fetch }),
  });

  return new ModelStepProviderRegistry([
    createModelStepProviderAdapter({
      providerId: 'deepseek',
      aiClient,
      clock: options.clock,
    }),
    createModelStepProviderAdapter({
      providerId: 'openai',
      aiClient,
      clock: options.clock,
    }),
    createModelStepProviderAdapter({
      providerId: 'anthropic',
      aiClient,
      clock: options.clock,
    }),
  ]);
}
