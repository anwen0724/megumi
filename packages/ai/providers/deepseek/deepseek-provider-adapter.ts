import {
    createOpenAICompatibleProviderAdapter,
    type FetchLike,
} from '../openai-compatible/openai-compatible-provider-adapter';

export interface DeepSeekProviderAdapterOptions {
    baseUrl: string;
    fetch: FetchLike;
}

export function createDeepSeekProviderAdapter(options: DeepSeekProviderAdapterOptions) {
    return createOpenAICompatibleProviderAdapter({
        providerId: 'deepseek',
        baseUrl: options.baseUrl,
        fetch: options.fetch,
    });
}
