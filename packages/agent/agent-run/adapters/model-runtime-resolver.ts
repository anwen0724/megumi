/*
 * Resolves Settings runtime configuration into an AI Provider and Model without a second protocol registry.
 */
import {
  createProvider,
  type Api,
  type Model,
  type Provider,
  type ProviderStreams,
} from '@megumi/ai';
import { anthropicMessagesApi } from '@megumi/ai/api/anthropic-messages.lazy';
import { googleGenerativeAIApi } from '@megumi/ai/api/google-generative-ai.lazy';
import { openAICodexResponsesApi } from '@megumi/ai/api/openai-codex-responses.lazy';
import { openAICompletionsApi } from '@megumi/ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@megumi/ai/api/openai-responses.lazy';
import { builtinProviders } from '@megumi/ai/providers/all';
import type { ProviderRuntimeConfig } from '../../settings';
import type { ResolvedModelRuntime } from '../services/model-call-service';

const apiImplementations: Record<string, ProviderStreams> = {
  'openai-completions': openAICompletionsApi(),
  'openai-responses': openAIResponsesApi(),
  'openai-codex-responses': openAICodexResponsesApi(),
  'anthropic-messages': anthropicMessagesApi(),
  'google-generative-ai': googleGenerativeAIApi(),
};

const builtins = builtinProviders();

export function resolveModelRuntime(config: ProviderRuntimeConfig): ResolvedModelRuntime {
  const builtinProvider = builtins.find((provider) => provider.id === config.provider_id);
  const builtinModel = builtinProvider?.getModels().find((model) => model.id === config.model_id);
  if (
    builtinProvider
    && builtinModel
    && builtinModel.api === config.api
    && builtinModel.baseUrl === config.base_url
  ) {
    return {
      provider: builtinProvider,
      model: {
        ...builtinModel,
        name: config.display_name,
        contextWindow: config.context_window_tokens,
        maxTokens: config.max_output_tokens,
        reasoning: config.capabilities.thinking === true,
        input: config.capabilities.imageInput === true ? ['text', 'image'] : ['text'],
      },
    };
  }

  const implementation = apiImplementations[config.api];
  if (!implementation) throw new Error(`Unsupported model API: ${config.api}`);
  if (!config.base_url) throw new Error(`Provider ${config.provider_id} requires a base URL.`);
  const model = customModel(config);
  const provider: Provider = createProvider({
    id: config.provider_id,
    name: config.provider_id,
    baseUrl: config.base_url,
    auth: {},
    models: [model],
    api: implementation,
  });
  return { provider, model };
}

function customModel(config: ProviderRuntimeConfig): Model<Api> {
  return {
    id: config.model_id,
    name: config.display_name,
    api: config.api,
    provider: config.provider_id,
    baseUrl: config.base_url ?? '',
    reasoning: config.capabilities.thinking === true,
    input: config.capabilities.imageInput === true ? ['text', 'image'] : ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: config.context_window_tokens,
    maxTokens: config.max_output_tokens,
  };
}
