// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { ProviderPublicStatus } from '@megumi/shared/provider-contracts';
import { useProviderStore } from '@megumi/desktop/renderer/entities/provider/store';

const providers: ProviderPublicStatus[] = [
  {
    providerId: 'deepseek',
    displayName: 'DeepSeek',
    enabled: true,
    baseUrl: 'https://api.deepseek.com',
    defaultModelId: 'deepseek-v4-flash',
    hasSecret: true,
    credentialSource: 'secret-store',
    envOverrideActive: false,
  },
];

function createSuccessMeta(channel: string, requestId = 'ipc-provider-request-1') {
  return {
    requestId,
    channel,
    handledAt: '2026-05-12T00:00:00.100Z',
  };
}

function installMegumiMock() {
  const provider = {
    list: vi.fn().mockResolvedValue({
      ok: true,
      data: { providers },
      meta: createSuccessMeta(IPC_CHANNELS.provider.list),
    }),
    update: vi.fn().mockResolvedValue({
      ok: true,
      data: {},
      meta: createSuccessMeta(IPC_CHANNELS.provider.update),
    }),
    setApiKey: vi.fn().mockResolvedValue({
      ok: true,
      data: {},
      meta: createSuccessMeta(IPC_CHANNELS.provider.setApiKey),
    }),
    deleteApiKey: vi.fn().mockResolvedValue({
      ok: true,
      data: {},
      meta: createSuccessMeta(IPC_CHANNELS.provider.deleteApiKey),
    }),
  };

  Object.defineProperty(window, 'megumi', {
    configurable: true,
    value: {
      provider,
      chat: {
        start: vi.fn(),
        cancel: vi.fn(),
      },
      runtime: {
        onEvent: vi.fn(),
      },
    },
  });

  return provider;
}

describe('useProviderStore', () => {
  beforeEach(() => {
    useProviderStore.setState({
      providers: [],
      status: 'idle',
      error: null,
    });
    vi.restoreAllMocks();
  });

  it('loads renderer-safe provider statuses', async () => {
    const providerApi = installMegumiMock();

    await useProviderStore.getState().loadProviders();

    expect(providerApi.list).toHaveBeenCalledWith(expect.objectContaining({
      payload: {},
      meta: expect.objectContaining({
        channel: IPC_CHANNELS.provider.list,
        source: 'renderer',
      }),
    }));
    expect(useProviderStore.getState().providers).toEqual(providers);
    expect(useProviderStore.getState().status).toBe('ready');
    expect(JSON.stringify(useProviderStore.getState().providers)).not.toContain('test-api-key-fixture');
  });

  it('updates provider settings and reloads statuses', async () => {
    const providerApi = installMegumiMock();

    await useProviderStore.getState().updateProvider({
      providerId: 'deepseek',
      enabled: false,
      baseUrl: 'https://proxy.local/deepseek',
      defaultModelId: 'deepseek-v4-pro',
    });

    expect(providerApi.update).toHaveBeenCalledWith(expect.objectContaining({
      payload: {
        providerId: 'deepseek',
        enabled: false,
        baseUrl: 'https://proxy.local/deepseek',
        defaultModelId: 'deepseek-v4-pro',
      },
      meta: expect.objectContaining({
        channel: IPC_CHANNELS.provider.update,
        source: 'renderer',
      }),
    }));
    expect(providerApi.list).toHaveBeenCalledTimes(1);
  });

  it('sets and deletes API keys without storing plaintext in state', async () => {
    const providerApi = installMegumiMock();

    await useProviderStore.getState().setApiKey({
      providerId: 'deepseek',
      apiKey: 'test-api-key-fixture',
    });
    await useProviderStore.getState().deleteApiKey({ providerId: 'deepseek' });

    expect(providerApi.setApiKey).toHaveBeenCalledWith(expect.objectContaining({
      payload: {
        providerId: 'deepseek',
        apiKey: 'test-api-key-fixture',
      },
      meta: expect.objectContaining({
        channel: IPC_CHANNELS.provider.setApiKey,
      }),
    }));
    expect(providerApi.deleteApiKey).toHaveBeenCalledWith(expect.objectContaining({
      payload: { providerId: 'deepseek' },
      meta: expect.objectContaining({
        channel: IPC_CHANNELS.provider.deleteApiKey,
      }),
    }));
    expect(JSON.stringify(useProviderStore.getState())).not.toContain('test-api-key-fixture');
  });

  it('stores a readable error from runtime ipc failure envelopes', async () => {
    Object.defineProperty(window, 'megumi', {
      configurable: true,
      value: {
        provider: {
          list: vi.fn().mockResolvedValue({
            ok: false,
            error: {
              code: 'config_invalid',
              message: 'Megumi config is invalid. Fix C:\\Users\\anwen\\.megumi\\config.json and try again.',
              severity: 'error',
              retryable: false,
              source: 'config',
            },
            meta: createSuccessMeta(IPC_CHANNELS.provider.list),
          }),
        },
      },
    });

    await useProviderStore.getState().loadProviders();

    expect(useProviderStore.getState()).toMatchObject({
      status: 'error',
      error: 'Megumi config is invalid. Fix C:\\Users\\anwen\\.megumi\\config.json and try again.',
    });
  });
});
