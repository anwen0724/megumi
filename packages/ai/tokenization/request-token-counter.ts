/*
 * Counts complete model-facing requests after protocol materialization.
 */
import type { AiCallRequest } from '../client/ai-call-request';
import type { JsonValue } from '../core/json';
import type { ProtocolRegistry } from '../protocols/protocol-registry';

export type RequestTokenCount = {
    inputTokens: number;
    accuracy: 'exact' | 'estimated';
};

export interface RequestTokenCounter {
    count(request: AiCallRequest): Promise<RequestTokenCount> | RequestTokenCount;
}

/**
 * Creates an offline request counter. Until a protocol supplies an exact
 * tokenizer, one UTF-8 byte is counted as one token. This deliberately
 * conservative estimator avoids claiming tokenizer precision and covers
 * punctuation, framing, structured content, and tool schemas.
 */
export function createRequestTokenCounter(registry: ProtocolRegistry): RequestTokenCounter {
    return {
        count(request) {
            const materialized = registry.materialize(request) ?? canonicalRequest(request);
            return {
                inputTokens: new TextEncoder().encode(JSON.stringify(materialized)).byteLength,
                accuracy: 'estimated',
            };
        },
    };
}

function canonicalRequest(request: AiCallRequest): JsonValue {
    const {
        signal: _signal,
        credential: _credential,
        ...serializableRequest
    } = request;

    return JSON.parse(JSON.stringify(serializableRequest)) as JsonValue;
}
