import { create } from 'zustand';
import type {
  ProviderApiKeyPayload,
  ProviderDeleteApiKeyPayload,
  ProviderListData,
  ProviderUpdatePayload,
} from '@megumi/renderer-contracts/ipc';
import type { ProviderId, ProviderPublicStatus } from '@megumi/renderer-contracts/provider';
import { getRuntimeIpcErrorMessage } from '../../shared/ipc';
import { requireMegumiRendererApi } from '../../shared/megumi-api';

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

    const result = await requireMegumiRendererApi().provider.list();

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

    const result = await requireMegumiRendererApi().provider.update(
      input satisfies ProviderUpdatePayload,
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

    const result = await requireMegumiRendererApi().provider.setApiKey(
      input satisfies ProviderApiKeyPayload,
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

    const result = await requireMegumiRendererApi().provider.deleteApiKey(
      input satisfies ProviderDeleteApiKeyPayload,
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

