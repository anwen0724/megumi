// @vitest-environment node
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAppSettingsStore } from '../../../src/desktop/infrastructure/app-settings-store';
import { createProviderSettingsStore } from '../../../src/desktop/infrastructure/provider-settings-store';
import type { DesktopIpcContext } from '../../../src/desktop/ipc/ipc-context';
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
});
