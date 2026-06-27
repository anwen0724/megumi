import { ProviderRegistryError } from '../core/provider-error';
import { type ProviderAdapter } from './provider-adapter';

export class ProviderRegistry {
    private readonly adapters: Map<string, ProviderAdapter>;

    constructor(adapters: ProviderAdapter[]) {
        this.adapters = new Map(
            adapters.map((adapter) => [adapter.providerId, adapter]),
        );
    }

    listProviderIds(): string[] {
        return Array.from(this.adapters.keys()).sort();
    }

    has(providerId: string): boolean {
        return this.adapters.has(providerId);
    }

    get(providerId: string): ProviderAdapter {
        const adapter = this.adapters.get(providerId);

        if (!adapter) {
            throw new ProviderRegistryError(
                `AI provider adapter is not registered: ${providerId}`,
            );
        }

        return adapter;
    }
}