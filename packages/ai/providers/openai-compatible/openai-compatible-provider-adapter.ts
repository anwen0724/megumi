import { type JsonObject } from '@megumi/shared/primitives/json';
import { createProviderError, type ProviderErrorCode } from '../../core/provider-error';
import { type TokenUsage } from '../../core/token-usage';
import {
    type AssistantContentBlock,
} from '../../messages/content-block';
import {
    type AssistantMessage,
} from '../../messages/conversation-message';
import { AssistantEventStream } from '../../streaming/assistant-event-stream';
import { type AssistantStreamEvent } from '../../streaming/assistant-stream-event';
import { type ProviderCredential } from '../../client/ai-client-options';
import {
    createProviderAdapter,
    type ProviderAdapter,
} from '../provider-adapter';
import { type ProviderAdapterRequest } from '../provider-adapter-request';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface OpenAICompatibleAdapterOptions {
    providerId: string;
    baseUrl: string;
    fetch: FetchLike;
}

interface ToolCallAccumulator {
    id?: string;
    name?: string;
    argumentsText: string;
}

interface OpenAICompatibleToolCall {
    id: string;
    function: {
        name: string;
        arguments: string;
    };
}

interface OpenAICompatibleStreamChunk {
    choices?: Array<{
        delta?: {
            content?: string | null;
            reasoning_content?: string | null;
            tool_calls?: Array<{
                index?: number;
                id?: string;
                function?: {
                    name?: string;
                    arguments?: string;
                };
            }>;
        };
        finish_reason?: string | null;
    }>;
    usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        prompt_tokens_details?: {
            cached_tokens?: number;
        };
        prompt_cache_hit_tokens?: number;
        prompt_cache_miss_tokens?: number;
    };
}

interface OpenAICompatibleCompletionResponse {
    choices?: Array<{
        message?: {
            content?: string | null;
            reasoning_content?: string | null;
            tool_calls?: OpenAICompatibleToolCall[];
        };
        finish_reason?: string | null;
    }>;
    usage?: NonNullable<OpenAICompatibleStreamChunk['usage']>;
}

export function createOpenAICompatibleProviderAdapter(
    options: OpenAICompatibleAdapterOptions,
): ProviderAdapter {
    return createProviderAdapter({
        providerId: options.providerId,
        stream: (request) =>
            AssistantEventStream.from(streamOpenAICompatible(options, request)),
    });
}

async function* streamOpenAICompatible(
    options: OpenAICompatibleAdapterOptions,
    request: ProviderAdapterRequest,
): AsyncIterable<AssistantStreamEvent> {
    let credential: ProviderCredential | undefined;

    try {
        credential = await resolveCredential(request);
    } catch (error) {
        yield createProviderErrorEvent({
            code: 'credential_error',
            message: 'Provider credential resolution failed.',
            retryable: false,
            providerId: options.providerId,
            modelId: request.model.modelId,
            details: {
                errorName: error instanceof Error ? error.name : 'UnknownError',
                errorMessage: redactSecret(
                    error instanceof Error ? error.message : String(error),
                ),
            },
        });
        return;
    }

    let response: Response;

    try {
        response = await postChatCompletion(options, request, credential);
    } catch (error) {
        yield createProviderErrorEvent({
            code: 'unknown_provider_error',
            message: 'Provider request failed.',
            retryable: true,
            providerId: options.providerId,
            modelId: request.model.modelId,
            details: {
                errorName: error instanceof Error ? error.name : 'UnknownError',
                errorMessage: redactSecret(
                    error instanceof Error ? error.message : String(error),
                ),
            },
        });
        return;
    }

    if (!response.ok) {
        yield await createHttpErrorEvent(options.providerId, request, response);
        return;
    }

    yield {
        type: 'message_start',
        messageId: 'assistant-0',
        role: 'assistant',
    };

    if (isJsonResponse(response)) {
        yield* streamOpenAICompatibleCompletion(options, request, response);
        return;
    }

    let text = '';
    let thinking = '';
    let stopReason: string | undefined;
    let usage: TokenUsage | undefined;
    let textStarted = false;
    let thinkingStarted = false;
    const toolCalls = new Map<number, ToolCallAccumulator>();
    const closedBlocks: AssistantContentBlock[] = [];

    try {
        for await (const chunk of parseSse(response.body)) {
            const choice = chunk.choices?.[0];

            if (chunk.usage) {
                usage = usageFromProvider(
                    options.providerId,
                    request.model.modelId,
                    chunk.usage,
                );
            }

            if (choice?.finish_reason) {
                stopReason = choice.finish_reason;
            }

            const reasoningDelta = choice?.delta?.reasoning_content;

            if (typeof reasoningDelta === 'string' && reasoningDelta.length > 0) {
                if (!thinkingStarted) {
                    thinkingStarted = true;
                    yield {
                        type: 'content_block_start',
                        index: closedBlocks.length,
                        block: {
                            type: 'thinking',
                            thinking: '',
                        },
                    };
                }

                thinking += reasoningDelta;

                yield {
                    type: 'content_block_delta',
                    index: closedBlocks.length,
                    delta: {
                        type: 'thinking_delta',
                        thinking: reasoningDelta,
                    },
                };
            }

            const textDelta = choice?.delta?.content;

            if (typeof textDelta === 'string' && textDelta.length > 0) {
                if (thinkingStarted) {
                    const block = {
                        type: 'thinking' as const,
                        thinking,
                    };

                    closedBlocks.push(block);

                    yield {
                        type: 'content_block_end',
                        index: closedBlocks.length - 1,
                        block,
                    };

                    thinkingStarted = false;
                }

                if (!textStarted) {
                    textStarted = true;

                    yield {
                        type: 'content_block_start',
                        index: closedBlocks.length,
                        block: {
                            type: 'text',
                            text: '',
                        },
                    };
                }

                text += textDelta;

                yield {
                    type: 'content_block_delta',
                    index: closedBlocks.length,
                    delta: {
                        type: 'text_delta',
                        text: textDelta,
                    },
                };
            }

            for (const toolDelta of choice?.delta?.tool_calls ?? []) {
                if (thinkingStarted) {
                    const block = {
                        type: 'thinking' as const,
                        thinking,
                    };

                    closedBlocks.push(block);

                    yield {
                        type: 'content_block_end',
                        index: closedBlocks.length - 1,
                        block,
                    };

                    thinkingStarted = false;
                }

                if (textStarted) {
                    const block = {
                        type: 'text' as const,
                        text,
                    };

                    closedBlocks.push(block);

                    yield {
                        type: 'content_block_end',
                        index: closedBlocks.length - 1,
                        block,
                    };

                    textStarted = false;
                }

                const index = toolDelta.index ?? 0;
                const existing = toolCalls.get(index);

                const next: ToolCallAccumulator = {
                    id: toolDelta.id ?? existing?.id,
                    name: toolDelta.function?.name ?? existing?.name,
                    argumentsText: `${existing?.argumentsText ?? ''}${toolDelta.function?.arguments ?? ''}`,
                };

                toolCalls.set(index, next);

                if (!existing) {
                    yield {
                        type: 'content_block_start',
                        index: closedBlocks.length + index,
                        block: {
                            type: 'toolCall',
                            ...(next.id ? { id: next.id } : {}),
                            ...(next.name ? { name: next.name } : {}),
                            argumentsText: '',
                        },
                    };
                }

                yield {
                    type: 'content_block_delta',
                    index: closedBlocks.length + index,
                    delta: {
                        type: 'tool_call_delta',
                        ...(toolDelta.id ? { id: toolDelta.id } : {}),
                        ...(toolDelta.function?.name
                            ? { name: toolDelta.function.name }
                            : {}),
                        ...(toolDelta.function?.arguments !== undefined
                            ? { argumentsTextDelta: toolDelta.function.arguments }
                            : {}),
                    },
                };
            }
        }
    } catch (error) {
        yield createProviderErrorEvent({
            code: 'stream_parse_error',
            message: 'Provider stream could not be parsed.',
            retryable: true,
            providerId: options.providerId,
            modelId: request.model.modelId,
            details: {
                errorName: error instanceof Error ? error.name : 'UnknownError',
                errorMessage: redactSecret(
                    error instanceof Error ? error.message : String(error),
                ),
            },
        });
        return;
    }

    if (thinkingStarted) {
        const block = {
            type: 'thinking' as const,
            thinking,
        };

        closedBlocks.push(block);

        yield {
            type: 'content_block_end',
            index: closedBlocks.length - 1,
            block,
        };
    }

    if (textStarted) {
        const block = {
            type: 'text' as const,
            text,
        };

        closedBlocks.push(block);

        yield {
            type: 'content_block_end',
            index: closedBlocks.length - 1,
            block,
        };
    }

    for (const [, toolCall] of Array.from(toolCalls.entries()).sort(
        ([left], [right]) => left - right,
    )) {
        if (!toolCall.id || !toolCall.name) {
            yield createProviderErrorEvent({
                code: 'stream_parse_error',
                message: 'Provider stream could not be parsed.',
                retryable: true,
                providerId: options.providerId,
                modelId: request.model.modelId,
                details: {
                    errorName: 'InvalidToolCall',
                    errorMessage: 'Provider tool call ended without id or name.',
                },
            });
            return;
        }

        const block = {
            type: 'toolCall' as const,
            id: toolCall.id,
            name: toolCall.name,
            argumentsText: toolCall.argumentsText,
        };

        closedBlocks.push(block);

        yield {
            type: 'content_block_end',
            index: closedBlocks.length - 1,
            block,
        };
    }

    const message: AssistantMessage = {
        role: 'assistant',
        content: closedBlocks,
        ...(stopReason ? { stopReason } : {}),
        ...(usage ? { usage } : {}),
    };

    yield {
        type: 'message_end',
        message,
    };
}

async function* streamOpenAICompatibleCompletion(
    options: OpenAICompatibleAdapterOptions,
    request: ProviderAdapterRequest,
    response: Response,
): AsyncIterable<AssistantStreamEvent> {
    const completion = await parseOpenAICompatibleCompletionResponse(response);
    const closedBlocks: AssistantContentBlock[] = [];

    if (completion.reasoningContent) {
        const block = {
            type: 'thinking' as const,
            thinking: completion.reasoningContent,
        };

        yield {
            type: 'content_block_start',
            index: closedBlocks.length,
            block: {
                type: 'thinking',
                thinking: '',
            },
        };

        yield {
            type: 'content_block_delta',
            index: closedBlocks.length,
            delta: {
                type: 'thinking_delta',
                thinking: completion.reasoningContent,
            },
        };

        closedBlocks.push(block);

        yield {
            type: 'content_block_end',
            index: closedBlocks.length - 1,
            block,
        };
    }

    if (completion.content.length > 0) {
        const block = {
            type: 'text' as const,
            text: completion.content,
        };

        yield {
            type: 'content_block_start',
            index: closedBlocks.length,
            block: {
                type: 'text',
                text: '',
            },
        };

        yield {
            type: 'content_block_delta',
            index: closedBlocks.length,
            delta: {
                type: 'text_delta',
                text: completion.content,
            },
        };

        closedBlocks.push(block);

        yield {
            type: 'content_block_end',
            index: closedBlocks.length - 1,
            block,
        };
    }

    for (const toolCall of completion.toolCalls) {
        const block = {
            type: 'toolCall' as const,
            id: toolCall.id,
            name: toolCall.function.name,
            argumentsText: toolCall.function.arguments,
        };

        yield {
            type: 'content_block_start',
            index: closedBlocks.length,
            block: {
                ...block,
                argumentsText: '',
            },
        };

        yield {
            type: 'content_block_delta',
            index: closedBlocks.length,
            delta: {
                type: 'tool_call_delta',
                id: toolCall.id,
                name: toolCall.function.name,
                argumentsTextDelta: toolCall.function.arguments,
            },
        };

        closedBlocks.push(block);

        yield {
            type: 'content_block_end',
            index: closedBlocks.length - 1,
            block,
        };
    }

    yield {
        type: 'message_end',
        message: {
            role: 'assistant',
            content: closedBlocks,
            ...(completion.finishReason
                ? { stopReason: completion.finishReason }
                : {}),
            ...(completion.usage
                ? {
                    usage: usageFromProvider(
                        options.providerId,
                        request.model.modelId,
                        completion.usage,
                    ),
                }
                : {}),
        },
    };
}

async function postChatCompletion(
    options: OpenAICompatibleAdapterOptions,
    request: ProviderAdapterRequest,
    credential: ProviderCredential | undefined,
): Promise<Response> {
    const headers = credentialHeaders(credential);

    return options.fetch(`${options.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers,
        signal: request.signal,
        body: JSON.stringify(buildOpenAICompatibleRequestBody(request)),
    });
}

function credentialHeaders(
    credential: ProviderCredential | undefined,
): Record<string, string> {
    const headers: Record<string, string> = {
        'content-type': 'application/json',
    };

    if (!credential) {
        return headers;
    }

    if (credential.type === 'api_key' || credential.type === 'bearer_token') {
        headers.authorization = `Bearer ${credential.value}`;
        return headers;
    }

    for (const [name, value] of Object.entries(credential.headers)) {
        headers[name.toLowerCase()] = value;
    }

    return headers;
}

function buildOpenAICompatibleRequestBody(request: ProviderAdapterRequest) {
    const messages = [];

    if (request.context.systemPrompt) {
        messages.push({
            role: 'system',
            content: request.context.systemPrompt,
        });
    }

    for (const message of request.context.messages) {
        if (message.role === 'user') {
            messages.push({
                role: 'user',
                content: message.content,
            });
            continue;
        }

        if (message.role === 'toolResult') {
            messages.push({
                role: 'tool',
                tool_call_id: message.toolCallId,
                content: message.content,
            });
            continue;
        }

        const textContent = message.content
            .filter((block) => block.type === 'text')
            .map((block) => block.text)
            .join('');

        const reasoningContent = message.content
            .filter((block) => block.type === 'thinking')
            .map((block) => block.thinking)
            .join('');

        const toolCalls = message.content
            .filter((block) => block.type === 'toolCall')
            .map((block) => ({
                id: block.id,
                type: 'function' as const,
                function: {
                    name: block.name,
                    arguments: block.argumentsText,
                },
            }));

        messages.push({
            role: 'assistant' as const,
            ...(textContent ? { content: textContent } : {}),
            ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
            ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        });
    }

    const tools = request.toolSet?.map((tool) => ({
        type: 'function' as const,
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
        },
    }));

    const stream = request.responseMode !== 'complete';

    return {
        model: request.model.modelId,
        messages,
        stream,
        ...(stream ? { stream_options: { include_usage: true } } : {}),
        ...(tools && tools.length > 0
            ? {
                tools,
                tool_choice: 'auto' as const,
            }
            : {}),
        ...(request.temperature !== undefined
            ? { temperature: request.temperature }
            : {}),
        ...(request.maxOutputTokens !== undefined
            ? { max_tokens: request.maxOutputTokens }
            : {}),
        ...(request.metadata ? { metadata: request.metadata } : {}),
    };
}

async function resolveCredential(
    request: ProviderAdapterRequest,
): Promise<ProviderCredential | undefined> {
    return (
        request.credential ??
        (await request.credentialResolver?.resolveCredential(
            request.model.providerId,
        ))
    );
}

async function* parseSse(
    body: ReadableStream<Uint8Array> | null,
): AsyncIterable<OpenAICompatibleStreamChunk> {
    if (!body) {
        throw new Error('Provider response did not include a stream body.');
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();

        if (done) {
            break;
        }

        buffer += decoder.decode(value, {
            stream: true,
        });

        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
            yield* parseSsePart(part);
        }
    }

    buffer += decoder.decode();

    if (buffer.trim()) {
        yield* parseSsePart(buffer);
    }
}

function* parseSsePart(part: string): Iterable<OpenAICompatibleStreamChunk> {
    const dataLines = part
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice('data:'.length).trim());

    for (const data of dataLines) {
        if (!data || data === '[DONE]') {
            continue;
        }

        yield JSON.parse(data) as OpenAICompatibleStreamChunk;
    }
}

function usageFromProvider(
    providerId: string,
    modelId: string,
    usage: NonNullable<OpenAICompatibleStreamChunk['usage']>,
): TokenUsage {
    const cacheRead =
        usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens;
    const cacheWrite = usage.prompt_cache_miss_tokens;

    return {
        providerId,
        modelId,
        ...(usage.prompt_tokens !== undefined
            ? { inputTokens: usage.prompt_tokens }
            : {}),
        ...(usage.completion_tokens !== undefined
            ? { outputTokens: usage.completion_tokens }
            : {}),
        ...(usage.total_tokens !== undefined
            ? { totalTokens: usage.total_tokens }
            : {}),
        ...(cacheRead !== undefined ? { cacheRead } : {}),
        ...(cacheWrite !== undefined ? { cacheWrite } : {}),
    };
}

async function parseOpenAICompatibleCompletionResponse(
    response: Response,
): Promise<{
    content: string;
    reasoningContent?: string;
    toolCalls: OpenAICompatibleToolCall[];
    finishReason?: string;
    usage?: NonNullable<OpenAICompatibleStreamChunk['usage']>;
}> {
    const body = (await response.json()) as OpenAICompatibleCompletionResponse;
    const choice = body.choices?.[0];
    const message = choice?.message;

    return {
        content: typeof message?.content === 'string' ? message.content : '',
        ...(typeof message?.reasoning_content === 'string' &&
        message.reasoning_content.length > 0
            ? { reasoningContent: message.reasoning_content }
            : {}),
        toolCalls: message?.tool_calls ?? [],
        ...(choice?.finish_reason ? { finishReason: choice.finish_reason } : {}),
        ...(body.usage ? { usage: body.usage } : {}),
    };
}

function isJsonResponse(response: Response): boolean {
    return (
        response.headers.get('content-type')?.toLowerCase().includes('application/json') ??
        false
    );
}

async function createHttpErrorEvent(
    providerId: string,
    request: ProviderAdapterRequest,
    response: Response,
): Promise<AssistantStreamEvent> {
    const preview = redactSecret((await response.text()).slice(0, 500));
    const { code, message, retryable } = classifyHttpError(response, preview);

    return createProviderErrorEvent({
        code,
        message,
        retryable,
        providerId,
        modelId: request.model.modelId,
        details: {
            httpStatus: response.status,
            httpStatusText: response.statusText,
            providerErrorBodyPreview: preview,
        },
    });
}

function classifyHttpError(
    response: Response,
    bodyPreview: string,
): {
    code: ProviderErrorCode;
    message: string;
    retryable: boolean;
} {
    if (response.status === 429) {
        return {
            code: 'rate_limited',
            message: 'Provider rate limit exceeded.',
            retryable: true,
        };
    }

    if (isTokenLimitError(response, bodyPreview)) {
        return {
            code: 'token_limited',
            message: 'Provider token limit exceeded.',
            retryable: false,
        };
    }

    if (response.status === 401 || response.status === 403) {
        return {
            code: 'provider_http_error',
            message: 'Provider authentication failed.',
            retryable: false,
        };
    }

    return {
        code: 'provider_http_error',
        message: 'Provider request failed.',
        retryable: response.status >= 500,
    };
}

function isTokenLimitError(response: Response, bodyPreview: string): boolean {
    return (
        response.status === 400 &&
        /context[_ ]length|maximum context|max[_ ]tokens|token limit/i.test(
            bodyPreview,
        )
    );
}

function createProviderErrorEvent(input: {
    code: ProviderErrorCode;
    message: string;
    retryable: boolean;
    providerId: string;
    modelId: string;
    details?: JsonObject;
}): AssistantStreamEvent {
    const error = createProviderError({
        providerId: input.providerId,
        modelId: input.modelId,
        code: input.code,
        message: input.message,
        retryable: input.retryable,
        details: input.details,
    });

    return {
        type: 'error',
        reason: 'error',
        message: {
            role: 'assistant',
            content: [],
            stopReason: 'error',
            error,
        },
    };
}

function redactSecret(text: string): string {
    return text.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]');
}