import { create } from 'zustand';
import { IPC_CHANNELS } from '@megumi/desktop/renderer/shared/ipc/channels';
import type {
  ProviderApiKeyPayload,
  ProviderDeletePayload,
  ProviderDeleteApiKeyPayload,
  ProviderUpdatePayload,
} from '@megumi/desktop/main/ipc/schemas';
import type {
  ProviderCatalogUiDto,
  ProviderPublicStatusUiDto,
} from '@megumi/product/host-interface';
import {
  createRendererRuntimeIpcRequest,
  getRuntimeIpcErrorMessage,
} from '../../shared/ipc';

export type ProviderStoreStatus = 'idle' | 'loading' | 'ready' | 'saving' | 'error';

export interface ProviderUpdateInput {
  providerId: string;
  enabled?: boolean;
  protocol?: 'openai-compatible' | 'anthropic';
  displayName?: string;
  baseUrl?: string;
  modelIds?: string[];
  apiKeyEnv?: string | null;
}

export interface ProviderApiKeyInput {
  providerId: string;
  apiKey: string;
}

export interface ProviderDeleteInput {
  providerId: string;
}

export interface ProviderDeleteApiKeyInput {
  providerId: string;
}

interface ProviderStoreState {
  providers: ProviderPublicStatusUiDto[];
  catalog: ProviderCatalogUiDto[];
  status: ProviderStoreStatus;
  error: string | null;
  loadProviders: () => Promise<void>;
  updateProvider: (input: ProviderUpdateInput) => Promise<void>;
  deleteProvider: (input: ProviderDeleteInput) => Promise<void>;
  setApiKey: (input: ProviderApiKeyInput) => Promise<void>;
  deleteApiKey: (input: ProviderDeleteApiKeyInput) => Promise<void>;
}

export const useProviderStore = create<ProviderStoreState>((set, get) => ({
  providers: [],
  catalog: [],
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
    if (result.data.status === 'failed') {
      set({
        status: 'error',
        error: result.data.failure.message,
      });
      return;
    }

    set({
      providers: result.data.providers,
      catalog: result.data.catalog,
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
    if (result.data.status === 'failed') {
      set({
        status: 'error',
        error: result.data.failure.message,
      });
      return;
    }

    await get().loadProviders();
  },
  deleteProvider: async (input) => {
    set({ status: 'saving', error: null });

    const result = await window.megumi.provider.delete(
      createRendererRuntimeIpcRequest(
        IPC_CHANNELS.settings.providerDelete,
        input satisfies ProviderDeletePayload,
      ),
    );

    if (!result.ok) {
      set({
        status: 'error',
        error: getRuntimeIpcErrorMessage(result),
      });
      return;
    }
    if (result.data.status === 'failed') {
      set({
        status: 'error',
        error: result.data.failure.message,
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
    if (result.data.status === 'failed') {
      set({
        status: 'error',
        error: result.data.failure.message,
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
    if (result.data.status === 'failed') {
      set({
        status: 'error',
        error: result.data.failure.message,
      });
      return;
    }

    await get().loadProviders();
  },
}));
