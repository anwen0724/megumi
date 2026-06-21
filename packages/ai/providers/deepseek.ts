// DeepSeek preset for the OpenAI-compatible provider adapter.
import { createOpenAICompatibleAdapter, type FetchLike } from './openai-compatible';

export function createDeepSeekProviderAdapter(options: { fetch: FetchLike }) {
  return createOpenAICompatibleAdapter({
    providerId: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    fetch: options.fetch,
  });
}
