import { create } from 'zustand';
import { IPC_CHANNELS } from '@megumi/shared/ipc';
import type { RuntimeIpcResult } from '@megumi/shared/ipc';
import type {
  ProviderApiKeyPayload,
  ProviderDeleteApiKeyPayload,
  ProviderListData,
  ProviderUpdatePayload,
} from '@megumi/shared/ipc';
import type { ProviderId, ProviderPublicStatus } from '@megumi/shared/provider';
import {
  createRendererRuntimeIpcRequest,
  getRuntimeIpcErrorMessage,
} from '../../shared/ipc';

export type ProviderStoreStatus = 'idle' | 'loading' | 'ready' | 'saving' | 'error';

export interface ProviderUpdateInput {
  providerId: ProviderId;
  enabled?: boolean;
  displayName?: string;
  baseUrl?: string;
  defaultModelId?: string;
  apiKeyEnv?: string | null;
}

export interface ProviderApiKeyInput {
  providerId: ProviderId;
  apiKey: string;
}

export interface ProviderDeleteApiKeyInput {
  providerId: ProviderId;
}

interface ProviderStoreState {
  providers: ProviderPublicStatus[];
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
      createRendererRuntimeIpcRequest(IPC_CHANNELS.provider.list, {}),
    );

    if (!result.ok) {
      set({
        status: 'error',
        error: getRuntimeIpcErrorMessage(result),
      });
      return;
    }

    set({
      providers: (result.data as ProviderListData).providers,
      status: 'ready',
      error: null,
    });
  },
  updateProvider: async (input) => {
    set({ status: 'saving', error: null });

    const result = await window.megumi.provider.update(
      createRendererRuntimeIpcRequest(
        IPC_CHANNELS.provider.update,
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
        IPC_CHANNELS.provider.setApiKey,
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
        IPC_CHANNELS.provider.deleteApiKey,
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

