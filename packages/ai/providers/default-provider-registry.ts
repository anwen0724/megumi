import { createAnthropicProviderAdapter } from './anthropic';
import { createDeepSeekProviderAdapter } from './deepseek';
import { createOpenAIProviderAdapter } from './openai';
import { type FetchLike } from './openai-compatible';
import { ProviderRegistry } from './provider-registry';

export interface CreateDefaultProviderRegistryOptions {
    fetch?: FetchLike;
}

export function createDefaultProviderRegistry(
    options: CreateDefaultProviderRegistryOptions = {},
): ProviderRegistry {
    const fetchImpl: FetchLike = options.fetch ?? fetch;

    return new ProviderRegistry([
        createDeepSeekProviderAdapter({ fetch: fetchImpl }),
        createOpenAIProviderAdapter({ fetch: fetchImpl }),
        createAnthropicProviderAdapter(),
    ]);
}
