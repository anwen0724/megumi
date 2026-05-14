import { AI_PROVIDER_DEFAULTS } from '../models';
import type { Clock, FetchLike } from '../types';
import { createOpenAICompatibleAdapter } from './openai-compatible';

export interface DeepSeekAdapterOptions {
  fetch: FetchLike;
  clock?: Clock;
}

export function createDeepSeekAdapter(options: DeepSeekAdapterOptions) {
  return createOpenAICompatibleAdapter({
    providerId: 'deepseek',
    defaultBaseUrl: AI_PROVIDER_DEFAULTS.deepseek.baseUrl ?? 'https://api.deepseek.com',
    fetch: options.fetch,
    clock: options.clock,
  });
}
