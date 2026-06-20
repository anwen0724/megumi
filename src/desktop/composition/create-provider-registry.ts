// Creates AI provider adapters from desktop provider settings without exposing settings storage to agent code.
import { ProviderRegistry, createOpenAICompatibleAdapter } from '../../ai';
import type { ProviderSettingsStore } from '../infrastructure/provider-settings-store';

export function createProviderRegistry(providerSettingsStore: ProviderSettingsStore): ProviderRegistry {
  const deepseek = providerSettingsStore.getProviderSettings('deepseek');
  const openai = providerSettingsStore.getProviderSettings('openai');
  return new ProviderRegistry([
    createOpenAICompatibleAdapter({
      providerId: 'deepseek',
      baseUrl: deepseek.baseUrl ?? 'https://api.deepseek.com',
      fetch,
    }),
    createOpenAICompatibleAdapter({
      providerId: 'openai',
      baseUrl: openai.baseUrl ?? 'https://api.openai.com/v1',
      fetch,
    }),
  ]);
}
