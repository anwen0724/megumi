import { type JsonObject, type JsonValue } from '../core/json';
import { type AiModel } from '../core/ai-model';
import { type ModelContext } from '../context/model-context';
import { type ToolSet } from '../tools/tool-set';
import { type ProviderCredential } from './ai-client-options';

export interface AiCallRequest {
    model: AiModel;
    context: ModelContext;
    tools?: ToolSet;

    signal?: AbortSignal;

    temperature?: number;
    maxOutputTokens?: number;
    structuredOutput?: AiStructuredOutputTarget;

    responseMode?: 'stream' | 'complete';
    transport?: 'sse' | 'websocket' | 'auto';
    cacheRetention?: 'none' | 'short' | 'long';

    maxRetries?: number;
    maxRetryDelayMs?: number;

    credential?: ProviderCredential;

    metadata?: JsonObject;
}

export interface AiStructuredOutputTarget {
    name: string;
    schema: JsonObject;
    strict?: boolean;
}

export interface AiStructuredOutputResult {
    value: JsonValue;
}
