/* Resolves the model catalog and prepares an isolated AI client for each task. */
import { createModels, createProvider, type Api, type Model, type Models, type Provider, type ProviderStreams } from '@megumi/ai';
import { builtinProviders } from '@megumi/ai/providers/all';
import { anthropicMessagesApi } from '@megumi/ai/api/anthropic-messages.lazy';
import { openAICompletionsApi } from '@megumi/ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@megumi/ai/api/openai-responses.lazy';
import { openAICodexResponsesApi } from '@megumi/ai/api/openai-codex-responses.lazy';

export interface ModelSelection {
  providerId: string;
  modelId: string;
}

export interface ModelOverrides {
  enabled?: boolean;
  displayName?: string;
  contextWindowTokens?: number;
  maxOutputTokens?: number;
  capabilities?: Partial<Record<'streaming' | 'toolCalls' | 'thinking' | 'imageInput', boolean | 'unknown'>>;
}

export interface ModelConfiguration {
  defaultModel?: ModelSelection;
  providers: Record<string, {
    enabled: boolean;
    displayName?: string;
    api?: string;
    baseUrl?: string;
    apiKeyEnv?: string;
  }>;
  customModels: Record<string, Record<string, ModelOverrides & { contextWindowTokens: number; maxOutputTokens: number }>>;
  modelOverrides: Record<string, Record<string, ModelOverrides>>;
}

/** The runtime consumes full snapshots structurally; definitions remain in Settings. */
export interface ModelSettingsAccess {
  readSettings():
    | { status: 'ok'; settings: { config: { models: ModelConfiguration; context: { compactionThresholdRatio: number } } } }
    | { status: 'rejected'; error: { code: string; message: string } };
  readCredential(request: { target: { kind: 'provider'; providerId: string }; apiKeyEnv?: string }):
    | { status: 'found'; value: string; source: 'stored' | 'environment' }
    | { status: 'missing' }
    | { status: 'rejected'; error: { code: string; message: string } };
}

export type ModelClient = Pick<Models, 'streamSimple' | 'completeSimple'>;
export interface PreparedModel {
  model: Model<Api>;
  client: ModelClient;
  compactionThresholdRatio: number;
}
export type ModelPreparationResult =
  | ({ status: 'ok' } & PreparedModel)
  | { status: 'failed'; failure: { code: string; message: string } };

export interface ConfiguredModel {
  model: Model<Api>;
  enabled: boolean;
  custom: boolean;
  capabilities: Required<NonNullable<ModelOverrides['capabilities']>>;
}
export interface ConfiguredProvider {
  id: string;
  name: string;
  enabled: boolean;
  api?: string;
  baseUrl?: string;
  models: ConfiguredModel[];
}
export type ModelCatalogResult =
  | { status: 'ok'; providers: ConfiguredProvider[]; defaultModel?: ModelSelection }
  | { status: 'failed'; failure: { code: string; message: string } };

export interface ModelResolutionOptions {
  settings: ModelSettingsAccess;
  apiImplementations?: Partial<Record<Api, ProviderStreams>>;
}

/** Lists configured models without materializing the AI catalog into settings. */
export function readModelCatalog(settings: ModelSettingsAccess): ModelCatalogResult {
  const read = settings.readSettings();
  if (read.status === 'rejected') return { status: 'failed', failure: read.error };
  return configuredCatalog(read.settings.config.models, builtinProviders());
}

function configuredCatalog(configuration: ModelConfiguration, builtins: readonly Provider[]): ModelCatalogResult {
  const ids = new Set([...builtins.map((provider) => provider.id), ...Object.keys(configuration.providers)]);
  const providers: ConfiguredProvider[] = [];
  for (const id of ids) {
    const builtin = builtins.find((provider) => provider.id === id);
    const settings = configuration.providers[id];
    const baseModels = builtin?.getModels() ?? [];
    const models: ConfiguredModel[] = baseModels.map((model) => configuredModel(
      { ...model, api: settings?.api ?? model.api, baseUrl: settings?.baseUrl ?? model.baseUrl },
      configuration.modelOverrides[id]?.[model.id],
      false,
    ));
    for (const [modelId, custom] of Object.entries(configuration.customModels[id] ?? {})) {
      if (baseModels.some((model) => model.id === modelId)) {
        return { status: 'failed', failure: { code: 'MODEL_CONFLICT', message: `Custom model ${id}/${modelId} duplicates an AI catalog model.` } };
      }
      const api = settings?.api ?? baseModels[0]?.api;
      const baseUrl = settings?.baseUrl ?? builtin?.baseUrl;
      if (!api || !baseUrl) return { status: 'failed', failure: { code: 'MODEL_UNAVAILABLE', message: `Provider ${id} requires an API and URL.` } };
      models.push(configuredModel({
        id: modelId, provider: id, api, baseUrl, name: modelId,
        contextWindow: custom.contextWindowTokens, maxTokens: custom.maxOutputTokens,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        reasoning: false, input: ['text'],
      }, custom, true));
    }
    providers.push({
      id,
      name: settings?.displayName ?? builtin?.name ?? id,
      enabled: settings?.enabled ?? true,
      api: settings?.api ?? baseModels[0]?.api,
      baseUrl: settings?.baseUrl ?? builtin?.baseUrl,
      models,
    });
  }
  for (const id of Object.keys(configuration.customModels)) {
    if (!ids.has(id)) return { status: 'failed', failure: { code: 'MODEL_UNAVAILABLE', message: `Provider ${id} is not configured.` } };
  }
  return { status: 'ok', providers, defaultModel: configuration.defaultModel };
}

function configuredModel(model: Model<Api>, overrides: ModelOverrides | undefined, custom: boolean): ConfiguredModel {
  const capabilities = {
    streaming: custom ? 'unknown' as const : true,
    toolCalls: custom ? 'unknown' as const : true,
    thinking: custom ? 'unknown' as const : model.reasoning,
    imageInput: custom ? 'unknown' as const : model.input.includes('image'),
    ...overrides?.capabilities,
  };
  return {
    enabled: overrides?.enabled ?? true,
    custom,
    capabilities,
    model: {
      ...model,
      name: overrides?.displayName ?? model.name,
      contextWindow: overrides?.contextWindowTokens ?? model.contextWindow,
      maxTokens: overrides?.maxOutputTokens ?? model.maxTokens,
      reasoning: capabilities.thinking === true,
      input: capabilities.imageInput === true ? ['text', 'image'] : ['text'],
    },
  };
}

/** Prepares fixed model parameters and a client that rereads credentials per request. */
export async function prepareModel(options: ModelResolutionOptions, selection?: ModelSelection): Promise<ModelPreparationResult> {
  const read = options.settings.readSettings();
  if (read.status === 'rejected') return { status: 'failed', failure: read.error };
  const configuration = read.settings.config;
  const builtins = builtinProviders();
  const catalog = configuredCatalog(configuration.models, builtins);
  if (catalog.status === 'failed') return catalog;
  const reference = selection ?? configuration.models.defaultModel;
  const provider = catalog.providers.find((item) => item.id === reference?.providerId);
  const configured = provider?.models.find((item) => item.model.id === reference?.modelId);
  if (!provider?.enabled || !configured?.enabled) {
    return { status: 'failed', failure: { code: 'MODEL_UNAVAILABLE', message: 'Select an enabled model from the current catalog.' } };
  }
  const model = configured.model;
  if (model.maxTokens > model.contextWindow) {
    return { status: 'failed', failure: { code: 'MODEL_UNAVAILABLE', message: 'Model output capacity exceeds its context window.' } };
  }
  const builtin = builtins.find((item) => item.id === provider.id);
  const apiKeyEnv = configuration.models.providers[provider.id]?.apiKeyEnv;
  const auth = {
    apiKey: {
      name: `${provider.name} credentials`,
      async resolve(input: Parameters<NonNullable<Provider['auth']['apiKey']>['resolve']>[0]) {
        const credential = options.settings.readCredential({ target: { kind: 'provider', providerId: provider.id }, apiKeyEnv });
        if (credential.status === 'rejected') throw new Error(credential.error.message);
        if (credential.status === 'found') return { auth: { apiKey: credential.value }, source: credential.source };
        if (apiKeyEnv) return undefined;
        return builtin?.auth.apiKey?.resolve(input);
      },
    },
  };
  const injected = options.apiImplementations?.[model.api];
  const matchingBuiltin = builtin?.getModels().some((item) => item.api === model.api);
  const implementation = injected ?? defaultApiImplementations[model.api];
  if (!matchingBuiltin && !implementation) {
    return { status: 'failed', failure: { code: 'MODEL_UNAVAILABLE', message: `Unsupported model API: ${model.api}` } };
  }
  const client = createModels();
  client.setProvider(builtin && matchingBuiltin && !injected
    ? { ...builtin, auth, getModels: () => [model] }
    : createProvider({ id: provider.id, name: provider.name, baseUrl: model.baseUrl, auth, models: [model], api: implementation! }));
  try {
    if (!await client.getAuth(provider.id)) {
      return { status: 'failed', failure: { code: 'MODEL_UNAVAILABLE', message: `Credentials are missing for ${provider.name}.` } };
    }
  } catch {
    return { status: 'failed', failure: { code: 'MODEL_UNAVAILABLE', message: `Credentials could not be read for ${provider.name}.` } };
  }
  return { status: 'ok', model, client, compactionThresholdRatio: configuration.context.compactionThresholdRatio };
}

const defaultApiImplementations: Readonly<Record<string, ProviderStreams>> = {
  'openai-completions': openAICompletionsApi(),
  'openai-responses': openAIResponsesApi(),
  'openai-codex-responses': openAICodexResponsesApi(),
  'anthropic-messages': anthropicMessagesApi(),
};
