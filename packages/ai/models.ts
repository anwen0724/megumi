import type { ModelId } from '@megumi/shared/model-contracts';
import type { ProviderId } from '@megumi/shared/provider-contracts';
import {
  DEFAULT_MODEL_BY_PROVIDER,
  MODEL_CATALOG,
  getDefaultModelId,
  getModelsForProvider,
} from '@megumi/shared/model-contracts';

export interface AiProviderDefaults {
  baseUrl?: string;
  defaultModelId: ModelId | string;
}

export const AI_PROVIDER_DEFAULTS: Record<ProviderId, AiProviderDefaults> = {
  deepseek: {
    baseUrl: 'https://api.deepseek.com',
    defaultModelId: DEFAULT_MODEL_BY_PROVIDER.deepseek,
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    defaultModelId: DEFAULT_MODEL_BY_PROVIDER.openai,
  },
  anthropic: {
    defaultModelId: DEFAULT_MODEL_BY_PROVIDER.anthropic,
  },
};

export {
  DEFAULT_MODEL_BY_PROVIDER,
  MODEL_CATALOG,
  getDefaultModelId,
  getModelsForProvider,
};
