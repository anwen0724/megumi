// @vitest-environment node
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAppSettingsStore } from '../../../src/desktop/infrastructure/app-settings-store';
import { createProviderSettingsStore } from '../../../src/desktop/infrastructure/provider-settings-store';
import type { DesktopIpcContext } from '../../../src/desktop/ipc/ipc-context';
import { handleProviderOperation } from '../../../src/desktop/ipc/provider.handler';
import { handleSettingsOperation } from '../../../src/desktop/ipc/settings.handler';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fsp.rm(root, { recursive: true, force: true })));
});

async function tempSettingsPath(): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'megumi-settings-src-'));
  roots.push(root);
  return path.join(root, 'settings.json');
}

describe('settings and provider infrastructure', () => {
  it('persists sparse settings and resolves defaults', async () => {
    const settingsPath = await tempSettingsPath();
    const settings = createAppSettingsStore({ settingsPath });

    expect(settings.getResolvedSettings()).toMatchObject({
      theme: 'midnight-blue',
      memory: { enabled: false },
      chat: { defaultProvider: 'deepseek' },
    });

    const updated = settings.updateSettings({
      theme: 'graphite-dark',
      memory: { enabled: true },
    });

    expect(updated.theme).toBe('graphite-dark');
    expect(updated.memory.enabled).toBe(true);
    expect(JSON.parse(await fsp.readFile(settingsPath, 'utf8'))).toEqual({
      theme: 'graphite-dark',
      memory: { enabled: true },
    });
  });

  it('returns provider public status and resolves credentials without exposing secrets', async () => {
    const settingsPath = await tempSettingsPath();
    const settings = createAppSettingsStore({ settingsPath });
    const providers = createProviderSettingsStore({
      settings,
      env: { DEEPSEEK_API_KEY: 'sk-env-secret' },
    });

    expect(providers.listProviderStatuses().find((provider) => provider.providerId === 'deepseek')).toMatchObject({
      providerId: 'deepseek',
      hasApiKey: true,
      credentialSource: 'environment',
      envOverrideActive: true,
    });

    providers.setProviderApiKey('deepseek', 'sk-settings-secret');
    const status = providers.listProviderStatuses().find((provider) => provider.providerId === 'deepseek');
    expect(status).toMatchObject({
      providerId: 'deepseek',
      hasApiKey: true,
      credentialSource: 'settings',
    });
    expect(JSON.stringify(status)).not.toContain('sk-settings-secret');
    await expect(providers.resolveCredential('deepseek')).resolves.toEqual({
      type: 'api_key',
      value: 'sk-settings-secret',
    });
  });

  it('keeps settings IPC responses renderer-safe while preserving credential resolution', async () => {
    const settingsPath = await tempSettingsPath();
    const settings = createAppSettingsStore({ settingsPath });
    const providers = createProviderSettingsStore({ settings });
    const context = {
      runtime: { settingsStore: settings },
    } as DesktopIpcContext;

    const updateResponse = await handleSettingsOperation('settings.update', {
      providers: {
        deepseek: {
          apiKey: 'sk-ipc-secret',
          apiKeyEnv: 'DEEPSEEK_API_KEY',
          baseUrl: 'https://api.deepseek.com',
        },
      },
    }, context) as { settings: { providers: { deepseek: Record<string, unknown> } } };

    await expect(providers.resolveCredential('deepseek')).resolves.toEqual({
      type: 'api_key',
      value: 'sk-ipc-secret',
    });
    expect(updateResponse.settings.providers.deepseek).not.toHaveProperty('apiKey');
    expect(updateResponse.settings.providers.deepseek).toMatchObject({
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      baseUrl: 'https://api.deepseek.com',
    });
    expect(JSON.stringify(updateResponse)).not.toContain('sk-ipc-secret');

    const getResponse = await handleSettingsOperation('settings.get', undefined, context) as {
      settings: { providers: { deepseek: Record<string, unknown> } };
    };

    expect(getResponse.settings.providers.deepseek).not.toHaveProperty('apiKey');
    expect(getResponse.settings.providers.deepseek).toMatchObject({
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      baseUrl: 'https://api.deepseek.com',
    });
    expect(JSON.stringify(getResponse)).not.toContain('sk-ipc-secret');
  });

  it('resolves customized provider API key environment names through the environment reader', async () => {
    const settingsPath = await tempSettingsPath();
    const settings = createAppSettingsStore({ settingsPath });
    const providers = createProviderSettingsStore({
      settings,
      env: {
        get: (key: string) => key === 'CUSTOM_DEEPSEEK_KEY' ? 'sk-custom-env-secret' : undefined,
      } as never,
    });

    providers.updateProviderSettings('deepseek', { apiKeyEnv: 'CUSTOM_DEEPSEEK_KEY' });

    expect(providers.listProviderStatuses().find((provider) => provider.providerId === 'deepseek')).toMatchObject({
      providerId: 'deepseek',
      hasApiKey: true,
      credentialSource: 'environment',
      envOverrideActive: true,
      apiKeyEnv: 'CUSTOM_DEEPSEEK_KEY',
      apiKeyEnvCustomized: true,
    });
    await expect(providers.resolveCredential('deepseek')).resolves.toEqual({
      type: 'api_key',
      value: 'sk-custom-env-secret',
    });
  });

  it('applies settings updates from renderer runtime request envelopes', async () => {
    const settingsPath = await tempSettingsPath();
    const settings = createAppSettingsStore({ settingsPath });
    const context = {
      runtime: { settingsStore: settings },
    } as DesktopIpcContext;

    const response = await handleSettingsOperation('settings.update', {
      requestId: 'ipc-settings-update',
      payload: {
        theme: 'sage-mist',
        memory: { enabled: true },
      },
      meta: {
        channel: 'settings:update',
        createdAt: '2026-06-20T00:00:00.000Z',
        source: 'renderer',
      },
    }, context) as { settings: { theme: string; memory: { enabled: boolean } } };

    expect(response.settings.theme).toBe('sage-mist');
    expect(response.settings.memory.enabled).toBe(true);
    expect(settings.getRawSettings()).toEqual({
      theme: 'sage-mist',
      memory: { enabled: true },
    });
  });

  it('applies provider updates from renderer runtime request envelopes', async () => {
    const settingsPath = await tempSettingsPath();
    const settings = createAppSettingsStore({ settingsPath });
    const providers = createProviderSettingsStore({ settings });
    const context = {
      runtime: {
        providerSettingsStore: providers,
      },
    } as DesktopIpcContext;

    await handleProviderOperation('provider.update', {
      requestId: 'ipc-provider-update',
      payload: {
        providerId: 'deepseek',
        enabled: false,
        baseUrl: 'https://example.test/v1',
        defaultModelId: 'deepseek-test',
        apiKeyEnv: 'DEEPSEEK_TEST_KEY',
      },
      meta: {
        channel: 'provider:update',
        createdAt: '2026-06-20T00:00:00.000Z',
        source: 'renderer',
      },
    }, context);

    await handleProviderOperation('provider.setApiKey', {
      requestId: 'ipc-provider-key',
      payload: {
        providerId: 'deepseek',
        apiKey: 'sk-renderer-secret',
      },
      meta: {
        channel: 'provider:set-api-key',
        createdAt: '2026-06-20T00:00:01.000Z',
        source: 'renderer',
      },
    }, context);

    const status = providers.listProviderStatuses().find((provider) => provider.providerId === 'deepseek');
    expect(status).toMatchObject({
      providerId: 'deepseek',
      enabled: false,
      baseUrl: 'https://example.test/v1',
      defaultModelId: 'deepseek-test',
      apiKeyEnv: 'DEEPSEEK_TEST_KEY',
      credentialSource: 'settings',
    });
    await expect(providers.resolveCredential('deepseek')).resolves.toEqual({
      type: 'api_key',
      value: 'sk-renderer-secret',
    });
  });
});
