/*
 * Creates the product-owned AI Models collection and resolves Settings model
 * configuration into provider-neutral Model values without exposing credentials.
 */
import type { ProviderRuntimeConfig } from '@megumi/agent/settings';
import {
  createModels,
  createProvider,
  InMemoryCredentialStore,
  type Api,
  type ApiKeyAuth,
  type CredentialStore,
  type Model,
  type Models,
  type Provider,
  type ProviderStreams,
} from '@megumi/ai';
import { anthropicMessagesApi } from '@megumi/ai/api/anthropic-messages.lazy';
import { googleGenerativeAIApi } from '@megumi/ai/api/google-generative-ai.lazy';
import { openAICodexResponsesApi } from '@megumi/ai/api/openai-codex-responses.lazy';
import { openAICompletionsApi } from '@megumi/ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@megumi/ai/api/openai-responses.lazy';
import { builtinProviders } from '@megumi/ai/providers/all';

const apiImplementations: Readonly<Record<string, ProviderStreams>> = {
  'openai-completions': openAICompletionsApi(),
  'openai-responses': openAIResponsesApi(),
  'openai-codex-responses': openAICodexResponsesApi(),
  'anthropic-messages': anthropicMessagesApi(),
  'google-generative-ai': googleGenerativeAIApi(),
};

export type ComposeModelsOptions = {
  credentials?: CredentialStore;
  apiImplementations?: Partial<Record<Api, ProviderStreams>>;
};

export function composeModels(options: ComposeModelsOptions = {}): {
  models: Models;
  resolveModel(config: ProviderRuntimeConfig): Promise<Model<Api>>;
} {
  const credentials = options.credentials ?? new InMemoryCredentialStore();
  const providers = builtinProviders();
  const builtinById = new Map(providers.map((provider) => [provider.id, provider]));
  const models = createModels({ credentials });

  for (const provider of providers) {
    models.setProvider(provider);
  }

  return {
    models,
    resolveModel: async (config) => {
      const injectedImplementation = options.apiImplementations?.[config.api];
      const builtinProvider = builtinById.get(config.provider_id);
      const builtinModel = builtinProvider
        ?.getModels()
        .find((model) => model.id === config.model_id);
      if (
        !injectedImplementation
        &&
        isMatchingBuiltin(config, builtinProvider, builtinModel)
        && builtinProvider?.auth.apiKey
        && builtinModel
      ) {
        await storeApiKey(credentials, config);
        models.setProvider(builtinProvider);
        return modelFromConfig(config, builtinModel);
      }

      const implementation = injectedImplementation
        ?? requireCustomProviderImplementation(config);
      if (!injectedImplementation) {
        await storeApiKey(credentials, config);
      }
      const model = modelFromConfig(config);
      models.setProvider(createProvider({
        id: config.provider_id,
        name: config.provider_id,
        baseUrl: config.base_url,
        auth: {
          apiKey: injectedImplementation
            ? injectedProviderAuth(config.provider_id)
            : storedApiKeyAuth(config.provider_id),
        },
        models: [model],
        api: implementation,
      }));
      return model;
    },
  };
}

function isMatchingBuiltin(
  config: ProviderRuntimeConfig,
  provider: Provider | undefined,
  model: Model<Api> | undefined,
): boolean {
  return provider !== undefined
    && model !== undefined
    && model.api === config.api
    && model.baseUrl === config.base_url;
}

function requireCustomProviderImplementation(
  config: ProviderRuntimeConfig,
): ProviderStreams {
  const implementation = apiImplementations[config.api];
  if (!implementation) {
    throw new Error(`Unsupported model API: ${config.api}`);
  }
  if (!config.base_url) {
    throw new Error(`Provider ${config.provider_id} requires a base URL.`);
  }
  return implementation;
}

async function storeApiKey(
  credentials: CredentialStore,
  config: ProviderRuntimeConfig,
): Promise<void> {
  const apiKey = config.api_key?.trim();
  if (!apiKey) {
    throw new Error(`Provider ${config.provider_id} requires an API key.`);
  }
  await credentials.modify(config.provider_id, async () => ({
    type: 'api_key',
    key: apiKey,
  }));
}

function storedApiKeyAuth(providerId: string): ApiKeyAuth {
  return {
    name: `${providerId} API key`,
    resolve: async ({ credential }) => credential?.key
      ? {
          auth: { apiKey: credential.key },
          source: 'stored credential',
        }
      : undefined,
  };
}

function injectedProviderAuth(providerId: string): ApiKeyAuth {
  return {
    name: `${providerId} injected model streams`,
    resolve: async () => ({
      auth: {},
      source: 'injected model streams',
    }),
  };
}

function modelFromConfig(
  config: ProviderRuntimeConfig,
  builtin?: Model<Api>,
): Model<Api> {
  return {
    ...(builtin ?? {
      id: config.model_id,
      api: config.api,
      provider: config.provider_id,
      baseUrl: config.base_url ?? '',
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    }),
    name: config.display_name,
    reasoning: config.capabilities.thinking === true,
    input: config.capabilities.imageInput === false ? ['text'] : ['text', 'image'],
    contextWindow: config.context_window_tokens,
    maxTokens: config.max_output_tokens,
  };
}
