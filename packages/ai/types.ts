import type { ChatRuntimeRequest } from '@megumi/shared/chat-contracts';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import type { ModelId } from '@megumi/shared/model-contracts';
import type { ProviderId, ProviderKind } from '@megumi/shared/provider-contracts';
import type { RunId } from '@megumi/shared/ids';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model-step-contracts';
import type { JsonObject } from '@megumi/shared/json';

export interface ProviderRuntimeConfig {
  providerId: ProviderId;
  kind: ProviderKind;
  baseUrl?: string;
  apiKey: string;
  defaultModelId: ModelId | string;
}

export interface AiChatAdapterRequest {
  request: ChatRuntimeRequest;
  runId: RunId | string;
  config: ProviderRuntimeConfig;
  signal?: AbortSignal;
  nextSequence: () => number;
  eventIdFactory: () => string;
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

export interface AiProviderAdapter {
  readonly providerId: ProviderId;
  streamModelStep(input: AiModelStepAdapterRequest): AsyncIterable<RuntimeEvent>;
  streamChat(input: AiChatAdapterRequest): AsyncIterable<RuntimeEvent>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface Clock {
  now(): string;
}

export interface OpenAICompatibleMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
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
