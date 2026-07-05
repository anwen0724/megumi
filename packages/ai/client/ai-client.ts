import { createProviderError } from '../core/provider-error';
import { type AssistantMessage } from '../messages/conversation-message';
import { AssistantEventStream } from '../streaming/assistant-event-stream';
import { type AiCallRequest } from './ai-call-request';
import { type AiClientOptions } from './ai-client-options';

export interface AiClient {
    stream(request: AiCallRequest): AssistantEventStream;
    complete(request: AiCallRequest): Promise<AssistantMessage>;
}

class DefaultAiClient implements AiClient {
    constructor(private readonly options: AiClientOptions) {}

    stream(request: AiCallRequest): AssistantEventStream {
        try {
            const adapter = this.options.registry.get(request.model.protocol);
            const metadata = {
                ...(this.options.defaultMetadata ?? {}),
                ...(request.metadata ?? {}),
            };

            return adapter.stream({
                ...request,
                credentialResolver: this.options.credentialResolver,
                maxRetries: request.maxRetries ?? this.options.defaultMaxRetries,
                maxRetryDelayMs:
                    request.maxRetryDelayMs ?? this.options.defaultMaxRetryDelayMs,
                ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
            });
        } catch (error) {
            return AssistantEventStream.from([
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
                            code: 'registry_error',
                            message: 'AI provider registry lookup failed.',
                            retryable: false,
                            details: {
                                errorName: error instanceof Error ? error.name : 'UnknownError',
                                errorMessage:
                                    error instanceof Error ? error.message : String(error),
                            },
                        }),
                    },
                },
            ]);
        }
    }

    async complete(request: AiCallRequest): Promise<AssistantMessage> {
        return this.stream({
            ...request,
            responseMode: 'complete',
        }).result();
    }
}

export function createAiClient(options: AiClientOptions): AiClient {
    return new DefaultAiClient(options);
}
