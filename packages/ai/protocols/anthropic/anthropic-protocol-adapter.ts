import { createProviderError } from '../../core/provider-error';
import { AssistantEventStream } from '../../streaming/assistant-event-stream';
import {
    createProtocolAdapter,
    type ProtocolAdapter,
} from '../protocol-adapter';
import { type FetchLike } from '../openai-compatible';

export interface AnthropicProtocolAdapterOptions {
    baseUrl?: string;
    fetch?: FetchLike;
}

export function createAnthropicProtocolAdapter(_options: AnthropicProtocolAdapterOptions = {}): ProtocolAdapter {
    return createProtocolAdapter({
        protocol: 'anthropic',

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
                            providerId: request.model.providerId,
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
