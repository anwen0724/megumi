import {
    createOpenAICompatibleProviderAdapter,
    type FetchLike,
} from '../openai-compatible/openai-compatible-provider-adapter';

export interface OpenAIProviderAdapterOptions {
    baseUrl: string;
    fetch: FetchLike;
}

export function createOpenAIProviderAdapter(options: OpenAIProviderAdapterOptions) {
    return createOpenAICompatibleProviderAdapter({
        providerId: 'openai',
        baseUrl: options.baseUrl,
        fetch: options.fetch,
    });
}
