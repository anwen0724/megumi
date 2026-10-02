/* Loads the runtime catalog and saves explicit edits from the provider settings form. */
import { create } from 'zustand';
import type { ConfiguredProvider, ConfiguredModel } from '@megumi/agent-runtime/runs/model-resolution';
import type { SettingsSnapshot, SettingsPatch, SettingsModelReference } from '@megumi/application/settings/settings-contracts';
import type { SettingsConfiguration } from '@megumi/application/settings/settings-schema';
import { rendererError, type RendererErrorDescriptor } from '../../shared/i18n';

export type ModelSupportLevelUi = boolean | 'unknown';
export type ModelCapabilitiesUiDto = ConfiguredModel['capabilities'];
type ProviderApi = NonNullable<SettingsConfiguration['models']['providers'][string]['api']>;
export interface ProviderCatalogUiDto {
  providerId: string;
  displayName: string;
  protocol: ProviderApi;
  defaultBaseUrl: string;
  models: Array<{ modelId: string; displayName: string; contextWindowTokens: number; maxOutputTokens: number; capabilities: ModelCapabilitiesUiDto }>;
}
export interface ProviderPublicStatusUiDto {
  providerId: string;
  displayName: string;
  protocol: ProviderApi;
  baseUrl?: string;
  enabled: boolean;
  modelIds: string[];
  modelSettings: Record<string, { displayName: string; contextWindowTokens: number; maxOutputTokens: number; capabilities: ModelCapabilitiesUiDto; capabilityOverrides: Partial<ModelCapabilitiesUiDto> }>;
  hasApiKey: boolean;
  credentialSource: 'stored' | 'environment' | 'missing';
}
export interface ProviderUpdateInput {
  providerId: string;
  displayName?: string;
  enabled?: boolean;
  protocol?: ProviderApi;
  baseUrl?: string;
  models?: Array<{ modelId: string; displayName?: string; contextWindowTokens: number; maxOutputTokens: number; imageInput?: ModelSupportLevelUi }>;
}
interface ProviderStoreState {
  providers: ProviderPublicStatusUiDto[];
  catalog: ProviderCatalogUiDto[];
  configured: ConfiguredProvider[];
  snapshot?: SettingsSnapshot;
  defaultModel?: SettingsModelReference;
  status: 'idle' | 'loading' | 'ready' | 'saving' | 'error';
  error: RendererErrorDescriptor | null;
  loadProviders(workspaceId?: string): Promise<void>;
  updateProvider(input: ProviderUpdateInput): Promise<boolean>;
  deleteProvider(input: { providerId: string }): Promise<boolean>;
  getApiKey(input: { providerId: string }): Promise<string>;
  setApiKey(input: { providerId: string; apiKey: string }): Promise<boolean>;
  deleteApiKey(input: { providerId: string }): Promise<boolean>;
  setDefaultModel(selection: SettingsModelReference): Promise<void>;
}

export const useProviderStore = create<ProviderStoreState>((set, get) => {
  const fail = (error: { code: string; message: string }) => {
    set({ status: 'error', error: rendererError(error.code, error.message) });
    return false;
  };
  const save = async (patch: SettingsPatch) => {
    const snapshot = get().snapshot;
    if (!snapshot) return false;
    set({ status: 'saving', error: null });
    const result = await window.megumi.settings.updateSettings({ patch, expectedRevision: snapshot.revision });
    if (!result.ok) return fail(result.data);
    set({ snapshot: result.data.settings });
    await get().loadProviders();
    return true;
  };
  const saveKey = async (providerId: string, value: string | null) => {
    const result = await window.megumi.settings.updateCredential({ target: { kind: 'provider', providerId }, value });
    if (!result.ok) return fail(result.data);
    await get().loadProviders();
    return true;
  };
  return {
    providers: [], catalog: [], configured: [], status: 'idle', error: null,
    async loadProviders(workspaceId) {
      set({ status: 'loading', error: null });
      const result = await window.megumi.models.getCatalog({ workspaceId });
      if (!result.ok) { fail(result.data); return; }
      if (result.data.status === 'failed') { fail(result.data.failure); return; }
      const baseline = await window.megumi.settings.readSettings();
      if (!baseline.ok) { fail(baseline.data); return; }
      const providers: ProviderPublicStatusUiDto[] = [];
      const catalog: ProviderCatalogUiDto[] = [];
      for (const provider of result.data.providers) {
        const key = await window.megumi.settings.readCredential({ target: { kind: 'provider', providerId: provider.id } });
        if (!key.ok) { fail(key.data); return; }
        const protocol = provider.api as ProviderApi;
        providers.push({
          providerId: provider.id, displayName: provider.name, protocol, baseUrl: provider.baseUrl, enabled: provider.enabled,
          modelIds: provider.models.filter((model) => model.enabled).map(({ model }) => model.id),
          modelSettings: Object.fromEntries(provider.models.map((item) => [item.model.id, {
            displayName: item.model.name, contextWindowTokens: item.model.contextWindow, maxOutputTokens: item.model.maxTokens,
            capabilities: item.capabilities, capabilityOverrides: baseline.data.config.models.modelOverrides[provider.id]?.[item.model.id]?.capabilities ?? {},
          }])),
          hasApiKey: key.data.status === 'found', credentialSource: key.data.status === 'found' ? key.data.source : 'missing',
        });
        catalog.push({ providerId: provider.id, displayName: provider.name, protocol, defaultBaseUrl: provider.baseUrl ?? '',
          models: provider.models.map((item) => ({ modelId: item.model.id, displayName: item.model.name, contextWindowTokens: item.model.contextWindow, maxOutputTokens: item.model.maxTokens, capabilities: item.capabilities })),
        });
      }
      set({ providers, catalog, configured: result.data.providers, snapshot: baseline.data, defaultModel: result.data.defaultModel, status: 'ready' });
    },
    async updateProvider(input) {
      const baseline = get().configured.find((provider) => provider.id === input.providerId);
      const provider: NonNullable<NonNullable<SettingsPatch['models']>['providers']>[string] = {};
      if (input.enabled !== undefined && input.enabled !== baseline?.enabled) provider.enabled = input.enabled;
      if (input.displayName !== undefined && input.displayName !== baseline?.name) provider.displayName = input.displayName;
      if (input.protocol !== undefined && input.protocol !== baseline?.api) provider.api = input.protocol;
      if (input.baseUrl !== undefined && input.baseUrl !== baseline?.baseUrl) provider.baseUrl = input.baseUrl || null;
      const custom: NonNullable<NonNullable<SettingsPatch['models']>['customModels']>[string] = {};
      const overrides: NonNullable<NonNullable<SettingsPatch['models']>['modelOverrides']>[string] = {};
      for (const model of input.models ?? []) {
        const previous = baseline?.models.find((item) => item.model.id === model.modelId);
        const changes: NonNullable<typeof overrides>[string] = {};
        if (!previous || model.displayName !== previous.model.name) changes.displayName = model.displayName;
        if (!previous || model.contextWindowTokens !== previous.model.contextWindow) changes.contextWindowTokens = model.contextWindowTokens;
        if (!previous || model.maxOutputTokens !== previous.model.maxTokens) changes.maxOutputTokens = model.maxOutputTokens;
        if (model.imageInput !== undefined && model.imageInput !== previous?.capabilities.imageInput) changes.capabilities = { imageInput: model.imageInput };
        if (previous && !previous.enabled) changes.enabled = true;
        if (Object.keys(changes).length) {
          if (!previous || previous.custom) custom[model.modelId] = changes;
          else overrides[model.modelId] = changes;
        }
      }
      if (input.models) for (const previous of baseline?.models ?? []) {
        if (input.models.some((model) => model.modelId === previous.model.id)) continue;
        if (previous.custom) custom[previous.model.id] = null;
        else if (previous.enabled) overrides[previous.model.id] = { enabled: false };
      }
      return save({ models: { providers: { [input.providerId]: provider }, customModels: { [input.providerId]: custom }, modelOverrides: { [input.providerId]: overrides } } });
    },
    deleteProvider: ({ providerId }) => save({ models: { providers: { [providerId]: null }, customModels: { [providerId]: null }, modelOverrides: { [providerId]: null } } }),
    async getApiKey({ providerId }) {
      const result = await window.megumi.settings.readCredential({ target: { kind: 'provider', providerId } });
      if (!result.ok) { fail(result.data); return ''; }
      return result.data.status === 'found' ? result.data.value : '';
    },
    setApiKey: ({ providerId, apiKey }) => saveKey(providerId, apiKey),
    deleteApiKey: ({ providerId }) => saveKey(providerId, null),
    async setDefaultModel(selection) { await save({ models: { defaultModel: selection } }); },
  };
});
