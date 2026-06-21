// Runtime-shaped registry used by current desktop callers until packages/agent owns model-step events.
import type { ProviderId } from '@megumi/shared/provider';
import { createProviderRegistry } from '../registry';
import type { ProviderRegistryOptions } from '../registry';
import { createModelStepProviderAdapter } from './model-step-provider-adapter';
import type { Clock, ModelStepProviderAdapter } from './model-step-types';

export interface ModelStepProviderRegistryOptions extends ProviderRegistryOptions {
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
  const pureRegistry = createProviderRegistry({ fetch: options.fetch });

  return new ModelStepProviderRegistry([
    createModelStepProviderAdapter({
      providerId: 'deepseek',
      provider: pureRegistry.get('deepseek'),
      clock: options.clock,
    }),
    createModelStepProviderAdapter({
      providerId: 'openai',
      provider: pureRegistry.get('openai'),
      clock: options.clock,
    }),
    createModelStepProviderAdapter({
      providerId: 'anthropic',
      provider: pureRegistry.get('anthropic'),
      clock: options.clock,
    }),
  ]);
}
