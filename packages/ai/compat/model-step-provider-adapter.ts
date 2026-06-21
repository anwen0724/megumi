// Wraps a pure ProviderAdapter with the current runtime-shaped model-step adapter interface.
import { JsonObjectSchema } from '@megumi/shared/primitives/json';
import type { RuntimeErrorCode } from '@megumi/shared/runtime';
import type { AssistantContentBlock } from '../message';
import type { ProviderAdapter } from '../provider';
import { mapModelStepToAiInput } from './model-step-request-mapper';
import { adaptAssistantStreamToRuntimeEvents } from './model-step-event-adapter';
import type {
  Clock,
  ModelStepAdapterRequest,
  ModelStepCompletionResult,
  ModelStepProviderAdapter,
  ProviderRuntimeConfig,
} from './model-step-types';
import { systemClock } from './model-step-types';

export function createModelStepProviderAdapter(input: {
  providerId: ProviderRuntimeConfig['providerId'];
  provider: ProviderAdapter;
  clock?: Clock;
}): ModelStepProviderAdapter {
  const clock = input.clock ?? systemClock;

  return {
    providerId: input.providerId,
    async *streamModelStep(request: ModelStepAdapterRequest) {
      const aiInput = mapModelStepToAiInput({
        request: request.request,
        config: request.config,
      });
      const stream = input.provider.stream({
        model: aiInput.model,
        context: aiInput.context,
        toolSet: aiInput.toolSet,
        options: {
          signal: request.signal,
          credential: { type: 'api_key', value: request.config.apiKey },
        },
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
      const message = await input.provider.stream({
        model: aiInput.model,
        context: aiInput.context,
        toolSet: aiInput.toolSet,
        options: {
          signal: request.signal,
          credential: { type: 'api_key', value: request.config.apiKey },
        },
      }).result();

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
