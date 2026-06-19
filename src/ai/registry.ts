// Registry for provider adapters used by the src AI module.
import { AiRegistryError } from './errors';
import { type ProviderAdapter } from './provider';

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
