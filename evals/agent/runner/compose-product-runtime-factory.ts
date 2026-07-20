/* Creates the production Evaluation runtime exclusively through Product Composition and Host. */
import { composeProduct, type ComposeProductOptions } from '@megumi/product/composition';
import {
  createEvaluationHomeOptions,
  createEvaluationInputFileReader,
  nodeObservabilityStorage,
  nodeSessionAttachmentFileSystem,
} from '../adapters/node-product-host-adapters';
import type { EvaluationProductRuntimeFactory } from './evaluation-runner';

export interface ComposeProductEvaluationFactoryOptions {
  credential?: string;
  requireCredential?: boolean;
  webSearch?: {
    provider: 'brave' | 'tavily' | 'exa' | 'custom';
    credential: string;
    baseUrl?: string;
  };
  productOverrides?: Partial<Omit<
    ComposeProductOptions,
    'home' | 'directoryPicker' | 'toolFileSystem' | 'isBuiltInToolAvailable' | 'observabilityStorage'
  >>;
}

export function createComposeProductEvaluationFactory(
  options: ComposeProductEvaluationFactoryOptions = {},
): EvaluationProductRuntimeFactory {
  return {
    async create(input) {
      if (options.requireCredential !== false && !options.credential) {
        throw new Error(`Provider credential is required for Evaluation target ${input.target.targetId}.`);
      }
      const product = composeProduct({
        ...options.productOverrides,
        home: createEvaluationHomeOptions(input.homeRoot),
        directoryPicker: {
          chooseDirectory: async () => ({ canceled: false, filePaths: [input.workspaceRoot] }),
        },
        observabilityStorage: nodeObservabilityStorage,
        inputFileReader: createEvaluationInputFileReader(input.workspaceRoot),
        sessionAttachmentFileSystem: nodeSessionAttachmentFileSystem,
        toolFileSystem: input.toolFileSystem,
        isBuiltInToolAvailable: input.isBuiltInToolAvailable,
        productEnvironment: { appVersion: 'evaluation', platform: process.platform, arch: process.arch },
      });

      try {
        await configureTarget(
          product.host,
          input.target.providerId,
          input.target.modelId,
          input.profile.permissionMode,
          options.credential,
          options.webSearch,
        );
        return product;
      } catch (error) {
        product.dispose();
        throw error;
      }
    },
  };
}

async function configureTarget(
  host: ReturnType<typeof composeProduct>['host'],
  providerId: string,
  modelId: string,
  permissionMode: 'ask' | 'auto' | 'full_access',
  credential?: string,
  webSearch?: ComposeProductEvaluationFactoryOptions['webSearch'],
): Promise<void> {
  const providers = await host.settings.listProviders();
  if (providers.status !== 'ok') throw new Error(providers.failure.message);
  const catalog = providers.catalog.find((item) => item.providerId === providerId);
  const catalogModel = catalog?.models.find((item) => item.modelId === modelId);
  const existing = providers.providers.find((item) => item.providerId === providerId);
  if (!catalog && !existing) throw new Error(`Unknown Provider for Evaluation target: ${providerId}`);
  if (catalog && !catalogModel) throw new Error(`Unknown model for Evaluation target: ${providerId}/${modelId}`);

  const updated = await host.settings.updateProvider({
    providerId,
    enabled: true,
    ...(catalog ? {
      protocol: catalog.protocol,
      displayName: catalog.displayName,
      baseUrl: catalog.defaultBaseUrl,
      modelIds: [modelId],
      models: catalogModel ? [{
        modelId,
        displayName: catalogModel.displayName,
        contextWindowTokens: catalogModel.contextWindowTokens,
        imageInput: catalogModel.capabilities.imageInput,
      }] : undefined,
    } : { modelIds: [modelId] }),
  });
  if (updated.status === 'failed') throw new Error(updated.failure.message);
  if (credential) {
    const credentialResult = await host.settings.setProviderApiKey({ providerId, apiKey: credential });
    if (credentialResult.status === 'failed') throw new Error(credentialResult.failure.message);
  }
  const settings = await host.settings.update({
    modelSelection: { providerId, modelId },
    permissions: { mode: permissionMode },
    ...(webSearch ? {
      web: {
        search: {
          provider: webSearch.provider,
          apiKey: webSearch.credential,
          ...(webSearch.baseUrl ? { baseUrl: webSearch.baseUrl } : {}),
        },
      },
    } : {}),
  });
  if (settings.status === 'failed') throw new Error(settings.failure.message);
}
