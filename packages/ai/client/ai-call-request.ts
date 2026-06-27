import { type JsonObject } from '@megumi/shared/primitives/json';
import { type AiModel } from '../core/ai-model';
import { type ModelContext } from '../context/model-context';
import { type ToolSet } from '../tools/tool-set';
import { type ProviderCredential } from './ai-client-options';

export interface AiCallRequest {
    model: AiModel;
    context: ModelContext;
    toolSet?: ToolSet;

    signal?: AbortSignal;

    temperature?: number;
    maxOutputTokens?: number;

    responseMode?: 'stream' | 'complete';
    transport?: 'sse' | 'websocket' | 'auto';
    cacheRetention?: 'none' | 'short' | 'long';

    maxRetries?: number;
    maxRetryDelayMs?: number;

    credential?: ProviderCredential;

    metadata?: JsonObject;
}