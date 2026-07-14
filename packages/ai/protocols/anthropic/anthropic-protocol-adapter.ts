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
        materialize: (request) => ({
            model: request.model.modelId,
            ...(request.context.systemPrompt ? { system: request.context.systemPrompt } : {}),
            messages: request.context.messages.flatMap<unknown>((message) => {
                if (message.role === 'context') {
                    return [{
                        role: 'user' as const,
                        content: [{
                            type: 'text' as const,
                            text: JSON.stringify({
                                type: 'reference_context',
                                kind: message.kind,
                                content: message.content,
                            }),
                        }],
                    }];
                }
                if (message.role === 'user') {
                    return [{
                        role: 'user' as const,
                        content: message.content.map((block) => {
                            if (block.type === 'text') return { type: 'text' as const, text: block.text };
                            if (block.type === 'json') return { type: 'text' as const, text: JSON.stringify(block.value) };
                            if (block.type === 'image' && block.source.type === 'base64') {
                                return {
                                    type: 'image' as const,
                                    source: {
                                        type: 'base64' as const,
                                        media_type: block.source.mediaType,
                                        data: block.source.data,
                                    },
                                };
                            }
                            throw new Error(`Unsupported Anthropic user content block: ${block.type}`);
                        }),
                    }];
                }
                if (message.role === 'toolResult') {
                    return [{
                        role: 'user' as const,
                        content: [{
                            type: 'tool_result' as const,
                            tool_use_id: message.toolCallId,
                            content: message.content,
                        }],
                    }];
                }
                return [{
                    role: 'assistant' as const,
                    content: message.content.map((block) => {
                        if (block.type === 'text') return { type: 'text' as const, text: block.text };
                        if (block.type === 'thinking') return { type: 'thinking' as const, thinking: block.thinking };
                        return {
                            type: 'tool_use' as const,
                            id: block.id,
                            name: block.name,
                            input: JSON.parse(block.argumentsText) as unknown,
                        };
                    }),
                }];
            }),
            ...(request.tools && request.tools.length > 0 ? {
                tools: request.tools.map((tool) => ({
                    name: tool.name,
                    description: tool.description,
                    input_schema: tool.inputSchema,
                })),
            } : {}),
        }),

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
