// Registers Anthropic as a pure AI provider while its protocol adapter is implemented later.
import { AssistantMessageEventStream } from '../event-stream';
import { createProviderError } from '../errors';
import { createProviderAdapter, type ProviderAdapter } from '../provider';

export function createAnthropicProviderAdapter(): ProviderAdapter {
  return createProviderAdapter({
    providerId: 'anthropic',
    stream: (request) => AssistantMessageEventStream.from([{
      type: 'error',
      reason: 'error',
      message: {
        role: 'assistant',
        content: [],
        stopReason: 'error',
        error: createProviderError({
          providerId: 'anthropic',
          modelId: request.model.modelId,
          code: 'unknown_provider_error',
          message: 'Anthropic provider is not implemented yet.',
          retryable: false,
        }),
      },
    }]),
  });
}
