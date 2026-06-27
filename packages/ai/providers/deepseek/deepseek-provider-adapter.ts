import {
    createOpenAICompatibleProviderAdapter,
    type FetchLike,
} from '../openai-compatible/openai-compatible-provider-adapter';

export function createDeepSeekProviderAdapter(options: { fetch: FetchLike }) {
    return createOpenAICompatibleProviderAdapter({
        providerId: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        fetch: options.fetch,
    });
}