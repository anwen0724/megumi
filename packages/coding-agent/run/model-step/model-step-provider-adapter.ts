// Wraps a pure ProviderAdapter with the current runtime-shaped model-step adapter interface.
import { JsonObjectSchema } from '@megumi/shared/primitives/json';
import type { RuntimeErrorCode } from '@megumi/shared/runtime';
import {
  createAiClient,
  createAnthropicProviderAdapter,
  createDeepSeekProviderAdapter,
  createOpenAIProviderAdapter,
  ProviderRegistry,
  type AssistantContentBlock,
} from '@megumi/ai';
import { mapModelStepToAiInput } from './model-step-request-mapper';
import { adaptAssistantStreamToRuntimeEvents } from './model-step-event-adapter';
import type {
  Clock,
  ModelStepAdapterRequest,
  ModelStepCompletionResult,
  ModelStepProviderAdapter,
  ProviderRuntimeConfig,
} from './model-step-types';
import { systemClock, type FetchLike } from './model-step-types';

export function createModelStepProviderAdapter(input: {
  providerId: ProviderRuntimeConfig['providerId'];
  fetch?: FetchLike;
  clock?: Clock;
}): ModelStepProviderAdapter {
  const clock = input.clock ?? systemClock;
  const fetchImpl = input.fetch ?? fetch;

  return {
    providerId: input.providerId,
    async *streamModelStep(request: ModelStepAdapterRequest) {
      const aiInput = mapModelStepToAiInput({
        request: request.request,
        config: request.config,
      });
      const aiClient = createAiClientForRuntimeConfig(request.config, fetchImpl);
      const stream = aiClient.stream({
        model: aiInput.model,
        context: aiInput.context,
        toolSet: aiInput.toolSet,
        signal: request.signal,
        credential: { type: 'api_key', value: request.config.apiKey },
      });

      yield* adaptAssistantStreamToRuntimeEvents({
        request,
        stream,
        clock,
      });
    },
    async completeModelStep(request: ModelStepAdapterRequest): Promise<ModelStepCompletionResult> {
      const aiInput = mapModelStepToAiInput({
        request: request.request,
        config: request.config,
      });
      const aiClient = createAiClientForRuntimeConfig(request.config, fetchImpl);
      const message = await aiClient.complete({
        model: aiInput.model,
        context: aiInput.context,
        toolSet: aiInput.toolSet,
        signal: request.signal,
        credential: { type: 'api_key', value: request.config.apiKey },
      });

      if (message.error) {
        return {
          ok: false,
          error: {
            code: mapProviderErrorCode(message.error.code),
            message: message.error.message,
            severity: 'error',
            retryable: message.error.retryable,
            source: 'provider',
            details: jsonObjectFromUnknown(message.error.details),
          },
        };
      }

      const toolCalls = message.content
        .filter((block) => block.type === 'toolCall')
        .map((block) => ({
          providerToolCallId: block.id,
          toolName: block.name,
          argumentsText: block.argumentsText,
        }));

      return {
        ok: true,
        text: message.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join(''),
        ...(message.stopReason ? { finishReason: message.stopReason } : {}),
        ...(message.usage ? {
          usage: {
            inputTokens: message.usage.inputTokens,
            outputTokens: message.usage.outputTokens,
            totalTokens: message.usage.totalTokens,
          },
        } : {}),
        ...(providerStatesFromThinkingBlocks(request, message.content).length > 0 ? {
          providerStates: providerStatesFromThinkingBlocks(request, message.content),
        } : {}),
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      };
    },
  };
}

function createAiClientForRuntimeConfig(config: ProviderRuntimeConfig, fetchImpl: FetchLike) {
  return createAiClient({
    registry: new ProviderRegistry([
      createProviderAdapterForRuntimeConfig(config, fetchImpl),
    ]),
  });
}

function createProviderAdapterForRuntimeConfig(config: ProviderRuntimeConfig, fetchImpl: FetchLike) {
  switch (config.providerId) {
    case 'openai':
      return createOpenAIProviderAdapter({
        baseUrl: requireBaseUrl(config),
        fetch: fetchImpl,
      });
    case 'deepseek':
      return createDeepSeekProviderAdapter({
        baseUrl: requireBaseUrl(config),
        fetch: fetchImpl,
      });
    case 'anthropic':
      return createAnthropicProviderAdapter({
        ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
        fetch: fetchImpl,
      });
  }
}

function requireBaseUrl(config: ProviderRuntimeConfig): string {
  if (!config.baseUrl) {
    throw new Error(`Provider base URL is required: ${config.providerId}`);
  }

  return config.baseUrl;
}

function providerStatesFromThinkingBlocks(
  request: ModelStepAdapterRequest,
  blocks: AssistantContentBlock[],
) {
  const thinking = blocks
    .filter((block) => block.type === 'thinking')
    .map((block) => block.thinking)
    .join('');

  if (thinking.length === 0) {
    return [];
  }

  return [{
    modelStepId: String(request.request.modelStepId ?? request.stepId),
    providerId: request.config.providerId,
    modelId: String(request.request.modelId || request.config.defaultModelId),
    blocks: [{
      type: 'reasoning_content' as const,
      text: thinking,
    }],
  }];
}

function mapProviderErrorCode(code: string): RuntimeErrorCode {
  switch (code) {
    case 'credential_error':
      return 'provider_missing_api_key';
    case 'provider_http_error':
      return 'provider_invalid_request';
    case 'rate_limited':
      return 'provider_rate_limited';
    case 'token_limited':
      return 'context_budget_exceeded';
    case 'stream_parse_error':
    case 'stream_source_error':
    case 'unknown_provider_error':
      return 'provider_network_error';
    case 'registry_error':
      return 'provider_unsupported';
    default:
      return 'provider_network_error';
  }
}

function jsonObjectFromUnknown(value: unknown) {
  const parsed = JsonObjectSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : {};
}
