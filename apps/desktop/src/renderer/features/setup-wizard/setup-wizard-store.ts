// Coordinates the renderer first-run setup flow through existing settings and provider IPC APIs.
import { create } from 'zustand';
import { IPC_CHANNELS } from '@megumi/shared/ipc';
import type { ProviderId } from '@megumi/shared/provider';
import type { AppLanguage, AppThemeName } from '@megumi/shared/settings';
import { createRendererRuntimeIpcRequest, getRuntimeIpcErrorMessage } from '../../shared/ipc';

export type SetupWizardStatus = 'idle' | 'loading' | 'ready' | 'saving' | 'error';

export interface CompleteSetupInput {
  language: AppLanguage;
  theme: AppThemeName;
  providerId: ProviderId;
  baseUrl?: string;
  defaultModelId: string;
  apiKey?: string;
  skipProvider?: boolean;
  completedAt?: string;
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

    if (!input.skipProvider) {
      const providerResult = await window.megumi.provider.update(
        createRendererRuntimeIpcRequest(IPC_CHANNELS.provider.update, {
          providerId: input.providerId,
          enabled: true,
          ...(input.baseUrl?.trim() ? { baseUrl: input.baseUrl.trim() } : {}),
          defaultModelId: input.defaultModelId,
        }),
      );

      if (!providerResult.ok) {
        set({ status: 'error', error: getRuntimeIpcErrorMessage(providerResult) });
        return;
      }

      const apiKey = input.apiKey?.trim();
      if (apiKey) {
        const apiKeyResult = await window.megumi.provider.setApiKey(
          createRendererRuntimeIpcRequest(IPC_CHANNELS.provider.setApiKey, {
            providerId: input.providerId,
            apiKey,
          }),
        );

        if (!apiKeyResult.ok) {
          set({ status: 'error', error: getRuntimeIpcErrorMessage(apiKeyResult) });
          return;
        }
      }
    }

    const settingsResult = await window.megumi.settings.update(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.settings.update, {
        language: input.language,
        theme: input.theme,
        chat: {
          defaultProvider: input.providerId,
        },
        setup: {
          completed: true,
          completedAt: input.completedAt ?? new Date().toISOString(),
        },
      }),
    );

    if (!settingsResult.ok) {
      set({ status: 'error', error: getRuntimeIpcErrorMessage(settingsResult) });
      return;
    }

    set({
      status: 'ready',
      setupCompleted: true,
      error: null,
    });
  },
}));
