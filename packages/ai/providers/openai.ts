// OpenAI preset for the OpenAI-compatible provider adapter.
import { createOpenAICompatibleAdapter, type FetchLike } from './openai-compatible';

export function createOpenAIProviderAdapter(options: { fetch: FetchLike }) {
  return createOpenAICompatibleAdapter({
    providerId: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    fetch: options.fetch,
  });
}
