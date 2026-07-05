import { create } from 'zustand';
import { IPC_CHANNELS } from '@megumi/desktop/renderer/shared/ipc/channels';
import type {
  ProviderApiKeyPayload,
  ProviderDeleteApiKeyPayload,
  ProviderUpdatePayload,
} from '@megumi/desktop/main/ipc/schemas';
import type { ProviderListUiResult, ProviderPublicStatusUiDto } from '@megumi/coding-agent/host-interface';
import {
  createRendererRuntimeIpcRequest,
  getRuntimeIpcErrorMessage,
} from '../../shared/ipc';

export type ProviderStoreStatus = 'idle' | 'loading' | 'ready' | 'saving' | 'error';

export interface ProviderUpdateInput {
  providerId: string;
  enabled?: boolean;
  displayName?: string;
  baseUrl?: string;
  modelIds?: string[];
  apiKeyEnv?: string | null;
}

export interface ProviderApiKeyInput {
  providerId: string;
  apiKey: string;
}

export interface ProviderDeleteApiKeyInput {
  providerId: string;
}

interface ProviderStoreState {
  providers: ProviderPublicStatusUiDto[];
  status: ProviderStoreStatus;
  error: string | null;
  loadProviders: () => Promise<void>;
  updateProvider: (input: ProviderUpdateInput) => Promise<void>;
  setApiKey: (input: ProviderApiKeyInput) => Promise<void>;
  deleteApiKey: (input: ProviderDeleteApiKeyInput) => Promise<void>;
}

export const useProviderStore = create<ProviderStoreState>((set, get) => ({
  providers: [],
  status: 'idle',
  error: null,
  loadProviders: async () => {
    set({ status: 'loading', error: null });

    const result = await window.megumi.provider.list(
      createRendererRuntimeIpcRequest(IPC_CHANNELS.settings.providerList, {}),
    );

    if (!result.ok) {
      set({
        status: 'error',
        error: getRuntimeIpcErrorMessage(result),
      });
      return;
    }

    set({
      providers: (result.data as ProviderListUiResult).providers,
      status: 'ready',
      error: null,
    });
  },
  updateProvider: async (input) => {
    set({ status: 'saving', error: null });

    const result = await window.megumi.provider.update(
      createRendererRuntimeIpcRequest(
        IPC_CHANNELS.settings.providerUpdate,
        input satisfies ProviderUpdatePayload,
      ),
    );

    if (!result.ok) {
      set({
        status: 'error',
        error: getRuntimeIpcErrorMessage(result),
      });
      return;
    }

    await get().loadProviders();
  },
  setApiKey: async (input) => {
    set({ status: 'saving', error: null });

    const result = await window.megumi.provider.setApiKey(
      createRendererRuntimeIpcRequest(
        IPC_CHANNELS.settings.providerSetApiKey,
        input satisfies ProviderApiKeyPayload,
      ),
    );

    if (!result.ok) {
      set({
        status: 'error',
        error: getRuntimeIpcErrorMessage(result),
      });
      return;
    }

    await get().loadProviders();
  },
  deleteApiKey: async (input) => {
    set({ status: 'saving', error: null });

    const result = await window.megumi.provider.deleteApiKey(
      createRendererRuntimeIpcRequest(
        IPC_CHANNELS.settings.providerDeleteApiKey,
        input satisfies ProviderDeleteApiKeyPayload,
      ),
    );

    if (!result.ok) {
      set({
        status: 'error',
        error: getRuntimeIpcErrorMessage(result),
      });
      return;
    }

    await get().loadProviders();
  },
}));
