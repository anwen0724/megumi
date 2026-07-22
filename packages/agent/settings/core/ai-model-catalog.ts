/*
 * Projects the AI package's built-in Providers and Models into Settings-owned catalog data.
 */
import { builtinProviders } from '@megumi/ai/providers/all';
import { capabilitiesFromModel } from '../../model-capability';
import {
  ProviderApiSchema,
  type ProviderApi,
  type ProviderCatalogDefinition,
} from '../contracts/provider-settings-contracts';

const providers = builtinProviders();

export function listBuiltinProviderCatalog(): ProviderCatalogDefinition[] {
  return providers.flatMap((provider) => {
    if (!provider.baseUrl) return [];
    const models = provider.getModels().flatMap((model) => {
      const api = knownApi(model.api);
      return api ? [{ model, api }] : [];
    });
    const api = models[0]?.api;
    if (!api) return [];
    return [{
      providerId: provider.id,
      displayName: provider.name,
      api,
      defaultBaseUrl: provider.baseUrl,
      models: models.map(({ model }) => ({
        modelId: model.id,
        displayName: model.name,
        contextWindowTokens: model.contextWindow,
        maxOutputTokens: model.maxTokens,
        capabilities: capabilitiesFromModel(model),
      })),
    }];
  });
}

export function getBuiltinProviderCatalog(providerId: string): ProviderCatalogDefinition | undefined {
  return listBuiltinProviderCatalog().find((provider) => provider.providerId === providerId);
}

export function getBuiltinModelCatalog(providerId: string, modelId: string) {
  return getBuiltinProviderCatalog(providerId)?.models.find((model) => model.modelId === modelId);
}

function knownApi(value: string): ProviderApi | undefined {
  const parsed = ProviderApiSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
