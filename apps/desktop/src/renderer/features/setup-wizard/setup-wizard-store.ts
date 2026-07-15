// Coordinates the renderer first-run setup flow through existing settings and provider IPC APIs.
import { create } from 'zustand';
import { IPC_CHANNELS } from '@megumi/desktop/renderer/shared/ipc/channels';
import type { AppLanguage, AppThemeName } from '@megumi/product/host-interface';
import { createRendererRuntimeIpcRequest } from '../../shared/ipc';
import { rendererError, type RendererErrorDescriptor } from '../../shared/i18n';

export type SetupWizardStatus = 'idle' | 'loading' | 'ready' | 'saving' | 'error';

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
  applyBootstrapSettings: (settings: { language: AppLanguage; setupCompleted: boolean }) => void;
  applyBootstrapFailure: (error: RendererErrorDescriptor) => void;
  completeSetup: (input: CompleteSetupInput) => Promise<void>;
}

export const useSetupWizardStore = create<SetupWizardState>((set) => ({
  status: 'idle',
  language: 'en-US',
  setupCompleted: null,
  error: null,
  applyBootstrapSettings: ({ language, setupCompleted }) => set({
    status: 'ready',
    language,
    setupCompleted,
    error: null,
  }),
  applyBootstrapFailure: (error) => set({ status: 'error', setupCompleted: false, error }),
  completeSetup: async (input) => {
    set({ status: 'saving', error: null });

    const apiKey = input.apiKey?.trim();
    const provider = input.skipProvider || !input.providerId
      ? undefined
      : {
          providerId: input.providerId,
          enabled: true,
          ...(input.baseUrl?.trim() ? { baseUrl: input.baseUrl.trim() } : {}),
          modelIds: input.modelIds,
          ...(apiKey ? { apiKey } : {}),
        };

    const settingsResult = await window.megumi.settings.completeSetup(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.settings.completeSetup, {
        language: input.language,
        theme: input.theme,
        ...(provider ? { provider } : {}),
      }),
    );

    if (!settingsResult.ok) {
      set({ status: 'error', error: rendererError(settingsResult.data.code, settingsResult.data.message) });
      return;
    }
    if (settingsResult.data.status === 'failed') {
      set({
        status: 'error',
        error: rendererError(settingsResult.data.failure.code, settingsResult.data.failure.message),
      });
      return;
    }

    if (settingsResult.data.settings.setup.completed !== true) {
      set({
        status: 'error',
        setupCompleted: false,
        error: rendererError('setup_incomplete'),
      });
      return;
    }

    set({
      status: 'ready',
      language: settingsResult.data.settings.language,
      setupCompleted: settingsResult.data.settings.setup.completed,
      error: null,
    });
  },
}));
