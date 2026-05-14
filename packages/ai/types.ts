import type { ChatRuntimeRequest } from '@megumi/shared/chat-contracts';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import type { ModelId } from '@megumi/shared/model-contracts';
import type { ProviderId, ProviderKind } from '@megumi/shared/provider-contracts';
import type { RunId } from '@megumi/shared/ids';

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

export interface AiProviderAdapter {
  readonly providerId: ProviderId;
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
