import { AI_PROVIDER_DEFAULTS } from '../models';
import type { Clock, FetchLike } from '../types';
import { createOpenAICompatibleAdapter } from './openai-compatible';

export interface OpenAIAdapterOptions {
  fetch: FetchLike;
  clock?: Clock;
}

export function createOpenAIAdapter(options: OpenAIAdapterOptions) {
  return createOpenAICompatibleAdapter({
    providerId: 'openai',
    defaultBaseUrl: AI_PROVIDER_DEFAULTS.openai.baseUrl ?? 'https://api.openai.com/v1',
    fetch: options.fetch,
    clock: options.clock,
  });
}
