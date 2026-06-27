import { createProviderError } from '../../core/provider-error';
import { AssistantEventStream } from '../../streaming/assistant-event-stream';
import {
    createProviderAdapter,
    type ProviderAdapter,
} from '../provider-adapter';

export function createAnthropicProviderAdapter(): ProviderAdapter {
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