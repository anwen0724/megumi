// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/desktop/main/ipc/channels';
import type { ProviderPublicStatusUiDto } from '@megumi/product/host-interface';
import { useProviderStore } from '@megumi/desktop/renderer/entities/provider/store';

const providers: ProviderPublicStatusUiDto[] = [
  {
    providerId: 'deepseek',
    displayName: 'DeepSeek',
    protocol: 'openai-compatible',
    enabled: true,
    baseUrl: 'https://api.deepseek.com',
    modelIds: ['deepseek-v4-flash'],
    hasApiKey: true,
    credentialSource: 'settings',
    envOverrideActive: false,
  },
];

function createSuccessMeta(channel: string, requestId = 'ipc-provider-request-1') {
  return {
    requestId,
    channel,
    traceId: 'trace-provider-request-1',
    operationName: channel.replace(':', '.'),
    handledAt: '2026-05-12T00:00:00.100Z',
  };
}

function installMegumiMock() {
  const provider = {
    list: vi.fn().mockResolvedValue({
      ok: true,
      data: { providers },
      meta: createSuccessMeta(IPC_CHANNELS.settings.providerList),
    }),
    update: vi.fn().mockResolvedValue({
      ok: true,
      data: {},
      meta: createSuccessMeta(IPC_CHANNELS.settings.providerUpdate),
    }),
    delete: vi.fn().mockResolvedValue({
      ok: true,
      data: {},
      meta: createSuccessMeta(IPC_CHANNELS.settings.providerDelete),
    }),
    setApiKey: vi.fn().mockResolvedValue({
      ok: true,
      data: {},
      meta: createSuccessMeta(IPC_CHANNELS.settings.providerSetApiKey),
    }),
    deleteApiKey: vi.fn().mockResolvedValue({
      ok: true,
      data: {},
      meta: createSuccessMeta(IPC_CHANNELS.settings.providerDeleteApiKey),
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
        channel: IPC_CHANNELS.settings.providerList,
        source: 'renderer',
      }),
      context: expect.objectContaining({
        requestId: expect.stringMatching(/^ipc-/),
        traceId: expect.stringMatching(/^trace-/),
        operationName: 'provider.list',
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
      modelIds: ['deepseek-v4-pro'],
    });

    expect(providerApi.update).toHaveBeenCalledWith(expect.objectContaining({
      payload: {
        providerId: 'deepseek',
        enabled: false,
        baseUrl: 'https://proxy.local/deepseek',
        modelIds: ['deepseek-v4-pro'],
      },
      meta: expect.objectContaining({
        channel: IPC_CHANNELS.settings.providerUpdate,
        source: 'renderer',
      }),
      context: expect.objectContaining({
        operationName: 'provider.update',
        source: 'renderer',
      }),
    }));
    expect(providerApi.list).toHaveBeenCalledTimes(1);
  });

  it('deletes provider settings and reloads statuses', async () => {
    const providerApi = installMegumiMock();

    await useProviderStore.getState().deleteProvider({
      providerId: 'deepseek',
    });

    expect(providerApi.delete).toHaveBeenCalledWith(expect.objectContaining({
      payload: {
        providerId: 'deepseek',
      },
      meta: expect.objectContaining({
        channel: IPC_CHANNELS.settings.providerDelete,
        source: 'renderer',
      }),
      context: expect.objectContaining({
        operationName: 'provider.delete',
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
        channel: IPC_CHANNELS.settings.providerSetApiKey,
      }),
    }));
    expect(providerApi.deleteApiKey).toHaveBeenCalledWith(expect.objectContaining({
      payload: { providerId: 'deepseek' },
      meta: expect.objectContaining({
        channel: IPC_CHANNELS.settings.providerDeleteApiKey,
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
            data: {
              code: 'config_invalid',
              message: 'Megumi settings are invalid. Fix C:\\Users\\anwen\\.megumi\\settings.json and try again.',
              severity: 'error',
              retryable: false,
              source: 'config',
              debugId: 'debug-provider-list-1',
            },
            meta: {
              ...createSuccessMeta(IPC_CHANNELS.settings.providerList),
              debugId: 'debug-provider-list-1',
            },
          }),
        },
      },
    });

    await useProviderStore.getState().loadProviders();

    expect(useProviderStore.getState()).toMatchObject({
      status: 'error',
      error: 'Megumi settings are invalid. Fix C:\\Users\\anwen\\.megumi\\settings.json and try again.',
    });
    expect(JSON.stringify(useProviderStore.getState())).not.toContain('stack trace');
    expect(JSON.stringify(useProviderStore.getState())).not.toContain('TEST_API_KEY_VALUE');
  });
});

