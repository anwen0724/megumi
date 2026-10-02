// Coordinates the renderer first-run setup flow through existing settings and provider IPC APIs.
import { create } from 'zustand';
import { IPC_CHANNELS } from '@megumi/desktop/renderer/shared/ipc/channels';
import type { AppLanguage, AppThemeName } from '@megumi/application/contracts';
import { createRendererRuntimeIpcRequest } from '../../shared/ipc';
import { rendererError, type RendererErrorDescriptor } from '../../shared/i18n';
import { useProviderStore } from '../../entities/provider';
import { useModelSelectionStore } from '../../entities/model-selection';

export type SetupWizardStatus = 'idle' | 'loading' | 'ready' | 'saving' | 'error' | 'load-error';
type LoadIssues = Array<{ path: string; message: string }>;

export interface CompleteSetupInput {
  language: AppLanguage;
  theme: AppThemeName;
  providerId?: string;
  baseUrl?: string;
  modelIds: string[];
  apiKey?: string;
  skipProvider?: boolean;
}

interface SetupWizardState {
  status: SetupWizardStatus;
  language: AppLanguage;
  setupCompleted: boolean | null;
  error: RendererErrorDescriptor | null;
  loadIssues: LoadIssues;
  applyBootstrapSettings: (settings: { language: AppLanguage; setupCompleted: boolean }) => void;
  applyBootstrapFailure: (error: RendererErrorDescriptor, issues?: LoadIssues) => void;
  completeSetup: (input: CompleteSetupInput) => Promise<void>;
}

export const useSetupWizardStore = create<SetupWizardState>((set) => ({
  status: 'idle',
  language: 'en-US',
  setupCompleted: null,
  error: null,
  loadIssues: [],
  applyBootstrapSettings: ({ language, setupCompleted }) => set({
    status: 'ready',
    language,
    setupCompleted,
    error: null,
    loadIssues: [],
  }),
  applyBootstrapFailure: (error, issues = []) => set({ status: 'load-error', setupCompleted: null, error, loadIssues: issues }),
  completeSetup: async (input) => {
    set({ status: 'saving', error: null });

    try {
      const baseline = await window.megumi.settings.readSettings();
      if (!baseline.ok) throw baseline.data;
      const providerId = input.skipProvider ? undefined : input.providerId;
      const patch: import('@megumi/application/settings/settings-contracts').SettingsPatch = {
        general: { language: input.language, theme: input.theme },
      };
      if (providerId) {
        const catalog = await window.megumi.models.getCatalog();
        if (!catalog.ok) throw catalog.data;
        if (catalog.data.status === 'failed') throw catalog.data.failure;
        const provider = catalog.data.providers.find((item) => item.id === providerId);
        const modelId = input.modelIds[0];
        if (!provider || !modelId || !provider.models.some((item) => item.model.id === modelId)) {
          throw new Error('Select a model from the current catalog.');
        }
        patch.models = {
          defaultModel: { providerId, modelId },
          providers: { [providerId]: {
            enabled: true,
            ...(input.baseUrl?.trim() && input.baseUrl.trim() !== provider.baseUrl ? { baseUrl: input.baseUrl.trim() } : {}),
          } },
        };
      }
      const saved = await window.megumi.settings.updateSettings({ patch, expectedRevision: baseline.data.revision });
      if (!saved.ok) throw saved.data;
      if (providerId && input.apiKey?.trim()) {
        const credential = await window.megumi.settings.updateCredential({ target: { kind: 'provider', providerId }, value: input.apiKey.trim() });
        if (!credential.ok) throw credential.data;
      }
      const current = await window.megumi.settings.readSettings();
      if (!current.ok) throw current.data;
      const completed = await window.megumi.settings.updateSettings({ patch: { general: { setupCompleted: true } }, expectedRevision: current.data.revision });
      if (!completed.ok) throw completed.data;
      const config = completed.data.settings.config;
      useModelSelectionStore.getState().applyBootstrapSelection(config.models.defaultModel);
      set({ status: 'ready', language: config.general.language, setupCompleted: config.general.setupCompleted, error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : undefined;
      set({ status: 'error', error: rendererError('settings_update_failed', message) });
    }
  },
}));
