/*
 * Resolves configured model parameters and catalogs from application settings and AI provider metadata.
 */
import type { Api, Model, Provider } from '@megumi/ai';
import { builtinProviders } from '@megumi/ai/providers/all';
import type {
  ConfiguredModel,
  ConfiguredProvider,
  ModelCatalogResult,
  ModelParameters,
  ModelSelection,
  ModelSettingsAccess,
  ProviderConfiguration,
} from '../contracts';

/** Resolves the existing selection into fixed model parameters without changing settings. */
export function resolveModel(input: {
  readonly settings: ModelSettingsAccess;
  readonly selection?: ModelSelection;
  readonly builtins: readonly Provider[];
}) {
  const read = input.settings.readSettings();
  if (read.status === 'rejected') return { status: 'failed' as const, failure: read.error };
  const catalog = configuredCatalog(read.settings.config.providers, input.builtins);
  if (catalog.status === 'failed') return catalog;
  const selection = input.selection ?? read.settings.config.general.lastSelectedModel;
  const provider = catalog.providers.find((item) => item.id === selection?.providerId);
  const selected = provider?.models.find((item) => item.model.id === selection?.modelId);
  if (!provider || !selected) return modelUnavailable('Select an added model.');
  const model = selected.model;
  if (model.maxTokens > model.contextWindow)
    return modelUnavailable('Model output capacity exceeds its context window.');
  return {
    status: 'ok' as const,
    model,
    providerId: provider.id,
    providerName: provider.name,
    compactionThresholdRatio: read.settings.config.context.compactionThresholdRatio,
  };
}

function modelUnavailable(message: string) {
  return { status: 'failed' as const, failure: { code: 'MODEL_UNAVAILABLE', message } };
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
