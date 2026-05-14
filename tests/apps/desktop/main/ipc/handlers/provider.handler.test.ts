// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderPublicStatus } from '@megumi/shared/provider-contracts';

const { handle } = vi.hoisted(() => ({
  handle: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => 'C:/Users/anwen/AppData/Roaming/Megumi'),
  },
  ipcMain: { handle },
}));

function createRequest(channel: string, payload: Record<string, unknown>, requestId = 'ipc-provider-request-1') {
  return {
    requestId,
    payload,
    meta: {
      channel,
      createdAt: '2026-05-12T00:00:00.000Z',
      source: 'renderer',
    },
  };
}

describe('registerProviderHandlers', () => {
  beforeEach(() => {
    vi.resetModules();
    handle.mockReset();
  });

  it('registers provider IPC handlers', async () => {
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc-channels');
    const { registerProviderHandlers } = await import('@megumi/desktop/main/ipc/handlers/provider.handler');

    registerProviderHandlers({
      getProviderSettings: vi.fn(),
      listProviderStatuses: vi.fn(),
      updateProviderSettings: vi.fn(),
      setProviderApiKey: vi.fn(),
      deleteProviderApiKey: vi.fn(),
    });

    expect(handle).toHaveBeenCalledWith(IPC_CHANNELS.provider.list, expect.any(Function));
    expect(handle).toHaveBeenCalledWith(IPC_CHANNELS.provider.update, expect.any(Function));
    expect(handle).toHaveBeenCalledWith(IPC_CHANNELS.provider.setApiKey, expect.any(Function));
    expect(handle).toHaveBeenCalledWith(IPC_CHANNELS.provider.deleteApiKey, expect.any(Function));
  });

  it('returns renderer-safe provider statuses in a runtime envelope', async () => {
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc-channels');
    const { registerProviderHandlers } = await import('@megumi/desktop/main/ipc/handlers/provider.handler');
    const statuses: ProviderPublicStatus[] = [
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
    const service = {
      getProviderSettings: vi.fn(),
      listProviderStatuses: vi.fn().mockResolvedValue(statuses),
      updateProviderSettings: vi.fn(),
      setProviderApiKey: vi.fn(),
      deleteProviderApiKey: vi.fn(),
    };

    registerProviderHandlers(service);

    const handler = handle.mock.calls.find(([channel]) => channel === IPC_CHANNELS.provider.list)?.[1];
    const result = await handler({}, createRequest(IPC_CHANNELS.provider.list, {}));

    expect(result).toMatchObject({
      ok: true,
      data: {
        providers: statuses,
      },
      meta: {
        requestId: 'ipc-provider-request-1',
        channel: IPC_CHANNELS.provider.list,
      },
    });
    expect(JSON.stringify(result)).not.toContain('test-api-key-fixture');
  });

  it('returns config_invalid for invalid Megumi Home config', async () => {
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc-channels');
    const { MegumiHomeConfigParseError } = await import('@megumi/desktop/main/services/megumi-home-config.service');
    const { registerProviderHandlers } = await import('@megumi/desktop/main/ipc/handlers/provider.handler');
    const configPath = 'C:/Users/anwen/.megumi/config.json';
    const service = {
      getProviderSettings: vi.fn(),
      listProviderStatuses: vi.fn().mockRejectedValue(
        new MegumiHomeConfigParseError(
          "Megumi config could not be read: Expected ',' after object property",
          configPath,
        ),
      ),
      updateProviderSettings: vi.fn(),
      setProviderApiKey: vi.fn(),
      deleteProviderApiKey: vi.fn(),
    };

    registerProviderHandlers(service);

    const handler = handle.mock.calls.find(([channel]) => channel === IPC_CHANNELS.provider.list)?.[1];
    const result = await handler({}, createRequest(IPC_CHANNELS.provider.list, {}));

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'config_invalid',
        message: `Megumi config is invalid. Fix ${configPath} and try again.`,
        severity: 'error',
        retryable: false,
        source: 'config',
        details: {
          configPath,
        },
      },
      meta: {
        requestId: 'ipc-provider-request-1',
        channel: IPC_CHANNELS.provider.list,
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('Error invoking remote ' + 'method');
    expect(serialized).not.toContain('MegumiHomeConfigParseError');
    expect(serialized).not.toContain("Expected ','");
  });

  it('rejects invalid update requests before calling the service', async () => {
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc-channels');
    const { registerProviderHandlers } = await import('@megumi/desktop/main/ipc/handlers/provider.handler');
    const service = {
      getProviderSettings: vi.fn(),
      listProviderStatuses: vi.fn(),
      updateProviderSettings: vi.fn(),
      setProviderApiKey: vi.fn(),
      deleteProviderApiKey: vi.fn(),
    };

    registerProviderHandlers(service);

    const handler = handle.mock.calls.find(([channel]) => channel === IPC_CHANNELS.provider.update)?.[1];
    const result = await handler({}, createRequest(IPC_CHANNELS.provider.update, {
      providerId: 'not-a-provider',
      enabled: false,
    }));

    expect(service.updateProviderSettings).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('ipc_invalid_request');
  });

  it('updates provider settings through the service', async () => {
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc-channels');
    const { registerProviderHandlers } = await import('@megumi/desktop/main/ipc/handlers/provider.handler');
    const service = {
      getProviderSettings: vi.fn(),
      listProviderStatuses: vi.fn(),
      updateProviderSettings: vi.fn().mockResolvedValue({ providerId: 'deepseek' }),
      setProviderApiKey: vi.fn(),
      deleteProviderApiKey: vi.fn(),
    };

    registerProviderHandlers(service);

    const handler = handle.mock.calls.find(([channel]) => channel === IPC_CHANNELS.provider.update)?.[1];
    await expect(handler({}, createRequest(IPC_CHANNELS.provider.update, {
      providerId: 'deepseek',
      enabled: false,
      baseUrl: 'https://proxy.local',
      defaultModelId: 'deepseek-v4-pro',
    }))).resolves.toMatchObject({
      ok: true,
      data: {},
      meta: {
        channel: IPC_CHANNELS.provider.update,
      },
    });

    expect(service.updateProviderSettings).toHaveBeenCalledWith('deepseek', {
      enabled: false,
      baseUrl: 'https://proxy.local',
      defaultModelId: 'deepseek-v4-pro',
    });
  });

  it('returns a safe update error instead of rejecting', async () => {
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc-channels');
    const { registerProviderHandlers } = await import('@megumi/desktop/main/ipc/handlers/provider.handler');
    const service = {
      getProviderSettings: vi.fn(),
      listProviderStatuses: vi.fn(),
      updateProviderSettings: vi.fn().mockRejectedValue(new Error('Provider settings write failed.')),
      setProviderApiKey: vi.fn(),
      deleteProviderApiKey: vi.fn(),
    };

    registerProviderHandlers(service);

    const handler = handle.mock.calls.find(([channel]) => channel === IPC_CHANNELS.provider.update)?.[1];
    const result = await handler({}, createRequest(IPC_CHANNELS.provider.update, {
      providerId: 'deepseek',
      enabled: false,
    }));

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'ipc_handler_failed',
        message: 'Provider settings request failed.',
        severity: 'error',
        retryable: true,
        source: 'main',
      },
    });
    expect(JSON.stringify(result)).not.toContain('Provider settings write failed.');
  });

  it('sets and deletes API keys without returning plaintext', async () => {
    const { IPC_CHANNELS } = await import('@megumi/shared/ipc-channels');
    const { registerProviderHandlers } = await import('@megumi/desktop/main/ipc/handlers/provider.handler');
    const service = {
      getProviderSettings: vi.fn(),
      listProviderStatuses: vi.fn(),
      updateProviderSettings: vi.fn(),
      setProviderApiKey: vi.fn().mockResolvedValue({ providerId: 'openai' }),
      deleteProviderApiKey: vi.fn().mockResolvedValue({ providerId: 'openai' }),
    };

    registerProviderHandlers(service);

    const setHandler = handle.mock.calls.find(([channel]) => channel === IPC_CHANNELS.provider.setApiKey)?.[1];
    const deleteHandler = handle.mock.calls.find(([channel]) => channel === IPC_CHANNELS.provider.deleteApiKey)?.[1];

    await expect(setHandler({}, createRequest(IPC_CHANNELS.provider.setApiKey, {
      providerId: 'openai',
      apiKey: 'test-api-key-fixture',
    }))).resolves.toMatchObject({
      ok: true,
      data: {},
      meta: {
        channel: IPC_CHANNELS.provider.setApiKey,
      },
    });
    await expect(deleteHandler({}, createRequest(IPC_CHANNELS.provider.deleteApiKey, {
      providerId: 'openai',
    }))).resolves.toMatchObject({
      ok: true,
      data: {},
      meta: {
        channel: IPC_CHANNELS.provider.deleteApiKey,
      },
    });

    expect(service.setProviderApiKey).toHaveBeenCalledWith('openai', 'test-api-key-fixture');
    const repeatedResult = await setHandler({}, createRequest(IPC_CHANNELS.provider.setApiKey, {
      providerId: 'openai',
      apiKey: 'test-api-key-fixture',
    }));
    expect(JSON.stringify(repeatedResult)).not.toContain('test-api-key-fixture');
  });
});
