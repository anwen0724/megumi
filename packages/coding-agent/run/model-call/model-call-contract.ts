// Defines the Coding Agent model-call boundary over the provider-neutral AI client.
import type { AiClient } from '@megumi/ai';
import type { ModelStepProviderState, ModelStepRuntimeRequest } from '@megumi/shared/model';
import type { RunId } from '@megumi/shared/primitives';
import type { ProviderId, ProviderKind } from '@megumi/shared/provider';
import type { ChatTokenUsagePayload, RuntimeError, RuntimeEvent } from '@megumi/shared/runtime';

export interface ProviderRuntimeConfig {
  providerId: ProviderId;
  kind: ProviderKind;
  baseUrl?: string;
  apiKey: string;
  defaultModelId: string;
}

export interface ModelCallRuntimeResolverPort {
  resolveProviderRuntimeConfig(input: {
    providerId: ProviderId;
    modelId?: string;
    runtimeContext?: ModelStepRuntimeRequest['runtimeContext'];
  }): Promise<ProviderRuntimeConfig>;
}

export interface ModelCallAiClientFactoryInput {
  config: ProviderRuntimeConfig;
}

export type ModelCallAiClientFactory = (input: ModelCallAiClientFactoryInput) => AiClient;

export interface ModelCallAdapterRequest {
  request: ModelStepRuntimeRequest;
  runId: RunId | string;
  stepId: string;
  config: ProviderRuntimeConfig;
  aiClient: AiClient;
  signal?: AbortSignal;
  nextSequence: () => number;
  eventIdFactory: () => string;
}

export interface ModelCallPortStreamInput {
  request: ModelStepRuntimeRequest;
  runId: RunId | string;
  stepId: string;
  signal?: AbortSignal;
  nextSequence: () => number;
  eventIdFactory: () => string;
}

export interface ModelCallPort {
  streamModelCall(input: ModelCallPortStreamInput): AsyncIterable<RuntimeEvent>;
}

export type ModelCallCompletionResult =
  | {
      ok: true;
      text: string;
      toolCalls?: ModelCallCompletionToolCall[];
      providerStates?: ModelStepProviderState[];
      finishReason?: string;
      usage?: ChatTokenUsagePayload;
    }
  | {
      ok: false;
      error: RuntimeError;
    };

export interface ModelCallCompletionToolCall {
  providerToolCallId: string;
  toolName: string;
  argumentsText: string;
}

export interface Clock {
  now(): string;
}

export const systemClock: Clock = {
  now: () => new Date().toISOString(),
};
