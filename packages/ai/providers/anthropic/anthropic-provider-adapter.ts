import { createProviderError } from '../../core/provider-error';
import { AssistantEventStream } from '../../streaming/assistant-event-stream';
import {
    createProviderAdapter,
    type ProviderAdapter,
} from '../provider-adapter';
import { type FetchLike } from '../openai-compatible';

export interface AnthropicProviderAdapterOptions {
    baseUrl?: string;
    fetch?: FetchLike;
}

export function createAnthropicProviderAdapter(_options: AnthropicProviderAdapterOptions = {}): ProviderAdapter {
    return createProviderAdapter({
        providerId: 'anthropic',

        stream: (request) =>
            AssistantEventStream.from([
                {
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
                },
            ]),
    });
}
