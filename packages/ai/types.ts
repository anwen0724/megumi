import type { ModelId, ModelStepProviderState, ModelStepRuntimeRequest } from '@megumi/shared/model';
import type { ProviderId, ProviderKind } from '@megumi/shared/provider';
import type { JsonObject, RunId } from '@megumi/shared/primitives';
import type { ChatTokenUsagePayload, RuntimeError, RuntimeEvent } from '@megumi/shared/runtime';

export interface ProviderRuntimeConfig {
  providerId: ProviderId;
  kind: ProviderKind;
  baseUrl?: string;
  apiKey: string;
  defaultModelId: ModelId | string;
}

export interface AiModelStepAdapterRequest {
  request: ModelStepRuntimeRequest;
  runId: RunId | string;
  stepId: string;
  config: ProviderRuntimeConfig;
  signal?: AbortSignal;
  nextSequence: () => number;
  eventIdFactory: () => string;
}

export type AiModelStepCompletionResult =
  | {
      ok: true;
      text: string;
      toolCalls?: AiModelStepCompletionToolCall[];
      providerStates?: ModelStepProviderState[];
      finishReason?: string;
      usage?: ChatTokenUsagePayload;
    }
  | {
      ok: false;
      error: RuntimeError;
    };

export interface AiModelStepCompletionToolCall {
  providerToolCallId: string;
  toolName: string;
  argumentsText: string;
}

export interface AiProviderAdapter {
  readonly providerId: ProviderId;
  streamModelStep(input: AiModelStepAdapterRequest): AsyncIterable<RuntimeEvent>;
  completeModelStep(input: AiModelStepAdapterRequest): Promise<AiModelStepCompletionResult>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface Clock {
  now(): string;
}

export interface OpenAICompatibleMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  reasoning_content?: string;
  tool_call_id?: string;
  tool_calls?: OpenAICompatibleToolCall[];
}

export interface OpenAICompatibleToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAICompatibleToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JsonObject;
  };
}

export interface OpenAICompatibleChatCompletionRequestBody {
  model: string;
  messages: OpenAICompatibleMessage[];
  stream?: boolean;
  stream_options?: {
    include_usage: boolean;
  };
  tools?: OpenAICompatibleToolDefinition[];
  tool_choice?: 'auto';
}

export interface OpenAICompatibleAdapterOptions {
  providerId: ProviderId;
  defaultBaseUrl: string;
  fetch: FetchLike;
  clock?: Clock;
}

export const systemClock: Clock = {
  now: () => new Date().toISOString(),
};
