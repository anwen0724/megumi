import { z } from 'zod';
/* Resolves the model catalog and prepares an isolated AI client for each task. */
import {
  createModels,
  createProvider,
  type Api,
  type Model,
  type Models,
  type Provider,
  type ProviderStreams,
} from '@megumi/ai';
import { builtinProviders } from '@megumi/ai/providers/all';
import { anthropicMessagesApi } from '@megumi/ai/api/anthropic-messages.lazy';
import { openAICompletionsApi } from '@megumi/ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@megumi/ai/api/openai-responses.lazy';
import { openAICodexResponsesApi } from '@megumi/ai/api/openai-codex-responses.lazy';

export interface ModelSelection {
  providerId: string;
  modelId: string;
}

export interface ModelParameters {
  name?: string;
  contextWindowTokens?: number;
  maxOutputTokens?: number;
  capabilities?: Partial<
    Record<'streaming' | 'toolCalls' | 'thinking' | 'imageInput', boolean | 'unknown'>
  >;
}
export interface ProviderConfiguration {
  name?: string;
  api?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  models: Record<string, ModelParameters>;
}

/** The runtime consumes full snapshots structurally; definitions remain in Settings. */
export interface ModelSettingsAccess {
  readSettings():
    | {
        status: 'ok';
        settings: {
          config: {
            providers: Record<string, ProviderConfiguration>;
            context: { compactionThresholdRatio: number };
          };
        };
      }
    | { status: 'rejected'; error: { code: string; message: string } };
  readCredential(request: {
    target: { kind: 'provider'; providerId: string };
    apiKeyEnv?: string;
  }):
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
  | { status: 'failed'; failure: { code: string; message: string; retryable?: boolean } };

export interface ConfiguredModel {
  model: Model<Api>;
  enabled: boolean;
  custom: boolean;
  capabilities: Required<NonNullable<ModelParameters['capabilities']>>;
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
  | { status: 'ok'; providers: ConfiguredProvider[]; catalog: ConfiguredProvider[] }
  | { status: 'failed'; failure: { code: string; message: string; retryable?: boolean } };

export interface ModelResolutionOptions {
  settings: ModelSettingsAccess;
  apiImplementations?: Partial<Record<Api, ProviderStreams>>;
}

/** Lists configured models without materializing the AI catalog into settings. */
export function readModelCatalog(settings: ModelSettingsAccess): ModelCatalogResult {
  const read = settings.readSettings();
  if (read.status === 'rejected') return { status: 'failed', failure: read.error };
  return configuredCatalog(read.settings.config.providers, builtinProviders());
}

/** Combines only added models with current builtins; the catalog remains available for adding. */
function configuredCatalog(
  configuration: Record<string, ProviderConfiguration>,
  builtins: readonly Provider[],
): ModelCatalogResult {
  const catalog: ConfiguredProvider[] = builtins.map((provider) => {
    const models = provider.getModels();
    return {
      id: provider.id,
      name: provider.name,
      enabled: true,
      api: models[0]?.api,
      baseUrl: provider.baseUrl,
      models: models.map((model) => configuredModel(model, undefined, false)),
    };
  });
  const providers: ConfiguredProvider[] = [];
  for (const [id, settings] of Object.entries(configuration)) {
    const builtin = builtins.find((provider) => provider.id === id);
    const originals = builtin?.getModels() ?? [];
    const models: ConfiguredModel[] = [];
    for (const [modelId, parameters] of Object.entries(settings.models)) {
      const original = originals.find((model) => model.id === modelId);
      const api = settings.api ?? original?.api ?? originals[0]?.api;
      const baseUrl = settings.baseUrl ?? original?.baseUrl ?? builtin?.baseUrl;
      if (!api || !baseUrl)
        return {
          status: 'failed',
          failure: {
            code: 'MODEL_UNAVAILABLE',
            message: `Provider ${id} requires an API and URL.`,
          },
        };
      if (
        !original &&
        (parameters.contextWindowTokens === undefined || parameters.maxOutputTokens === undefined)
      ) {
        return {
          status: 'failed',
          failure: {
            code: 'MODEL_UNAVAILABLE',
            message: `Model ${id}/${modelId} requires capacity parameters.`,
          },
        };
      }
      const model: Model<Api> = original
        ? { ...original, api, baseUrl }
        : {
            id: modelId,
            provider: id,
            api,
            baseUrl,
            name: modelId,
            contextWindow: parameters.contextWindowTokens!,
            maxTokens: parameters.maxOutputTokens!,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            reasoning: false,
            input: ['text'],
          };
      models.push(configuredModel(model, parameters, !original));
    }
    providers.push({
      id,
      name: settings.name ?? builtin?.name ?? id,
      enabled: true,
      api: settings.api ?? originals[0]?.api,
      baseUrl: settings.baseUrl ?? builtin?.baseUrl,
      models,
    });
  }
  return { status: 'ok', providers, catalog };
}

function configuredModel(
  model: Model<Api>,
  overrides: ModelParameters | undefined,
  custom: boolean,
): ConfiguredModel {
  const capabilities = {
    streaming: custom ? ('unknown' as const) : true,
    toolCalls: custom ? ('unknown' as const) : true,
    thinking: custom ? ('unknown' as const) : model.reasoning,
    imageInput: custom ? ('unknown' as const) : model.input.includes('image'),
    ...overrides?.capabilities,
  };
  return {
    enabled: true,
    custom,
    capabilities,
    model: {
      ...model,
      name: overrides?.name ?? model.name,
      contextWindow: overrides?.contextWindowTokens ?? model.contextWindow,
      maxTokens: overrides?.maxOutputTokens ?? model.maxTokens,
      reasoning: capabilities.thinking === true,
      input: capabilities.imageInput === true ? ['text', 'image'] : ['text'],
    },
  };
}

/** Prepares fixed model parameters and a client that rereads credentials per request. */
export async function prepareModel(
  options: ModelResolutionOptions,
  selection?: ModelSelection,
): Promise<ModelPreparationResult> {
  const read = options.settings.readSettings();
  if (read.status === 'rejected') return { status: 'failed', failure: read.error };
  const configuration = read.settings.config;
  const builtins = builtinProviders();
  const catalog = configuredCatalog(configuration.providers, builtins);
  if (catalog.status === 'failed') return catalog;
  const reference = selection;
  const provider = catalog.providers.find((item) => item.id === reference?.providerId);
  const configured = provider?.models.find((item) => item.model.id === reference?.modelId);
  if (!provider?.enabled || !configured?.enabled) {
    return {
      status: 'failed',
      failure: { code: 'MODEL_UNAVAILABLE', message: 'Select an added model.' },
    };
  }
  const model = configured.model;
  if (model.maxTokens > model.contextWindow) {
    return {
      status: 'failed',
      failure: {
        code: 'MODEL_UNAVAILABLE',
        message: 'Model output capacity exceeds its context window.',
      },
    };
  }
  const builtin = builtins.find((item) => item.id === provider.id);
  const apiKeyEnv = configuration.providers[provider.id]?.apiKeyEnv;
  const auth = {
    apiKey: {
      name: `${provider.name} credentials`,
      async resolve(input: Parameters<NonNullable<Provider['auth']['apiKey']>['resolve']>[0]) {
        const credential = options.settings.readCredential({
          target: { kind: 'provider', providerId: provider.id },
          apiKeyEnv,
        });
        if (credential.status === 'rejected') throw new Error(credential.error.message);
        if (credential.status === 'found')
          return { auth: { apiKey: credential.value }, source: credential.source };
        if (apiKeyEnv) return undefined;
        return builtin?.auth.apiKey?.resolve(input);
      },
    },
  };
  const injected = options.apiImplementations?.[model.api];
  const matchingBuiltin = builtin?.getModels().some((item) => item.api === model.api);
  const implementation = injected ?? defaultApiImplementations[model.api];
  if (!matchingBuiltin && !implementation) {
    return {
      status: 'failed',
      failure: { code: 'MODEL_UNAVAILABLE', message: `Unsupported model API: ${model.api}` },
    };
  }
  const client = createModels();
  client.setProvider(
    builtin && matchingBuiltin && !injected
      ? { ...builtin, auth, getModels: () => [model] }
      : createProvider({
          id: provider.id,
          name: provider.name,
          baseUrl: model.baseUrl,
          auth,
          models: [model],
          api: implementation!,
        }),
  );
  try {
    if (!(await client.getAuth(provider.id))) {
      return {
        status: 'failed',
        failure: {
          code: 'MODEL_UNAVAILABLE',
          message: `Credentials are missing for ${provider.name}.`,
        },
      };
    }
  } catch {
    return {
      status: 'failed',
      failure: {
        code: 'MODEL_UNAVAILABLE',
        message: `Credentials could not be read for ${provider.name}.`,
      },
    };
  }
  return {
    status: 'ok',
    model,
    client,
    compactionThresholdRatio: configuration.context.compactionThresholdRatio,
  };
}

const defaultApiImplementations: Readonly<Record<string, ProviderStreams>> = {
  'openai-completions': openAICompletionsApi(),
  'openai-responses': openAIResponsesApi(),
  'openai-codex-responses': openAICodexResponsesApi(),
  'anthropic-messages': anthropicMessagesApi(),
};

const SupportSchema = z.union([z.boolean(), z.literal('unknown')]);
const ConfiguredProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  api: z.string().optional(),
  baseUrl: z.string().optional(),
  models: z.array(
    z.object({
      enabled: z.boolean(),
      custom: z.boolean(),
      capabilities: z.object({
        streaming: SupportSchema,
        toolCalls: SupportSchema,
        thinking: SupportSchema,
        imageInput: SupportSchema,
      }),
      model: z.object({
        id: z.string(),
        name: z.string(),
        provider: z.string(),
        api: z.string(),
        baseUrl: z.string(),
        reasoning: z.boolean(),
        input: z.array(z.enum(['text', 'image'])),
        cost: z.object({
          input: z.number(),
          output: z.number(),
          cacheRead: z.number(),
          cacheWrite: z.number(),
        }),
        contextWindow: z.number(),
        maxTokens: z.number(),
      }),
    }),
  ),
});
export const ModelCatalogResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('failed'),
    failure: z.object({ code: z.string(), message: z.string() }),
  }),
  z.object({
    status: z.literal('ok'),
    providers: z.array(ConfiguredProviderSchema),
    catalog: z.array(ConfiguredProviderSchema),
  }),
]);
