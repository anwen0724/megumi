import {
    createOpenAICompatibleProviderAdapter,
    type FetchLike,
} from '../openai-compatible/openai-compatible-provider-adapter';

export function createOpenAIProviderAdapter(options: { fetch: FetchLike }) {
    return createOpenAICompatibleProviderAdapter({
        providerId: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        fetch: options.fetch,
    });
}