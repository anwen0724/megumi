// Temporary runtime-shaped AI compatibility types for current desktop model-step callers.
import type { ModelId, ModelStepProviderState, ModelStepRuntimeRequest } from '@megumi/shared/model';
import type { ProviderId, ProviderKind } from '@megumi/shared/provider';
import type { ChatTokenUsagePayload, RuntimeError, RuntimeEvent } from '@megumi/shared/runtime';
import type { FetchLike } from '../providers/openai-compatible';

export type { FetchLike };

export interface ProviderRuntimeConfig {
  providerId: ProviderId;
  kind: ProviderKind;
  baseUrl?: string;
  apiKey: string;
  defaultModelId: ModelId | string;
}

export interface ModelStepAdapterRequest {
  request: ModelStepRuntimeRequest;
  runId: string;
  stepId: string;
  config: ProviderRuntimeConfig;
  signal?: AbortSignal;
  nextSequence: () => number;
  eventIdFactory: () => string;
}

export type ModelStepCompletionResult =
  | {
      ok: true;
      text: string;
      toolCalls?: ModelStepCompletionToolCall[];
      providerStates?: ModelStepProviderState[];
      finishReason?: string;
      usage?: ChatTokenUsagePayload;
    }
  | {
      ok: false;
      error: RuntimeError;
    };

export interface ModelStepCompletionToolCall {
  providerToolCallId: string;
  toolName: string;
  argumentsText: string;
}

export interface ModelStepProviderAdapter {
  readonly providerId: ProviderId;
  streamModelStep(input: ModelStepAdapterRequest): AsyncIterable<RuntimeEvent>;
  completeModelStep(input: ModelStepAdapterRequest): Promise<ModelStepCompletionResult>;
}

export interface Clock {
  now(): string;
}

export const systemClock: Clock = {
  now: () => new Date().toISOString(),
};
