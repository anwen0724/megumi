// Coordinates the renderer first-run setup flow through existing settings and provider IPC APIs.
import { create } from 'zustand';
import { IPC_CHANNELS } from '@megumi/desktop/renderer/shared/ipc/channels';
import type { AppLanguage, AppThemeName } from '@megumi/product/host-interface';
import { createRendererRuntimeIpcRequest, getRuntimeIpcErrorMessage } from '../../shared/ipc';

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
  setupCompleted: boolean | null;
  error: string | null;
  hydrate: () => Promise<void>;
  completeSetup: (input: CompleteSetupInput) => Promise<void>;
}

export const useSetupWizardStore = create<SetupWizardState>((set) => ({
  status: 'idle',
  setupCompleted: null,
  error: null,
  hydrate: async () => {
    set({ status: 'loading', error: null });

    const result = await window.megumi.settings.get(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.settings.get, {}),
    );

    if (!result.ok) {
      set({ status: 'error', error: getRuntimeIpcErrorMessage(result), setupCompleted: false });
      return;
    }

    set({
      status: 'ready',
      setupCompleted: result.data.settings.setup.completed,
      error: null,
    });
  },
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
      set({ status: 'error', error: getRuntimeIpcErrorMessage(settingsResult) });
      return;
    }

    if (settingsResult.data.settings.setup.completed !== true) {
      set({
        status: 'error',
        setupCompleted: false,
        error: 'Setup completion was not saved.',
      });
      return;
    }

    set({
      status: 'ready',
      setupCompleted: settingsResult.data.settings.setup.completed,
      error: null,
    });
  },
}));
