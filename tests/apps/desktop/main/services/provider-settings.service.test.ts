// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PROVIDER_SETTINGS,
  type ProviderId,
  type ProviderSettings,
  type SecretRef,
} from '@megumi/shared/provider';
import { buildProviderApiKeySecretRef } from '@megumi/security/secret-policy';
import {
  ProviderSettingsService,
  type ProviderSettingsRepositoryPort,
  type ProviderSecretStorePort,
} from '@megumi/desktop/main/services/provider-settings.service';

class MemoryProviderSettingsRepository implements ProviderSettingsRepositoryPort {
  readonly settings = new Map<ProviderId, ProviderSettings>();

  initializeDefaults(): void {
    for (const settings of Object.values(DEFAULT_PROVIDER_SETTINGS)) {
      if (!this.settings.has(settings.providerId)) {
        this.settings.set(settings.providerId, {
          ...settings,
          createdAt: '2026-05-11T00:00:00.000Z',
          updatedAt: '2026-05-11T00:00:00.000Z',
        });
      }
    }
  }

  list(): ProviderSettings[] {
    const order: ProviderId[] = ['deepseek', 'openai', 'anthropic'];
    return order.flatMap((providerId) => {
      const settings = this.settings.get(providerId);
      return settings ? [settings] : [];
    });
  }

  get(providerId: ProviderId): ProviderSettings | undefined {
    return this.settings.get(providerId);
  }

  updateProvider(providerId: ProviderId, update: Partial<ProviderSettings>): ProviderSettings {
    const existing = this.settings.get(providerId) ?? {
      ...DEFAULT_PROVIDER_SETTINGS[providerId],
      createdAt: '2026-05-11T00:00:00.000Z',
      updatedAt: '2026-05-11T00:00:00.000Z',
    };

    const next = {
      ...existing,
      ...update,
      updatedAt: '2026-05-11T01:00:00.000Z',
    };

    this.settings.set(providerId, next);
    return next;
  }
}

class MemorySecretStore implements ProviderSecretStorePort {
  readonly values = new Map<string, string>();

  async setSecret(ref: SecretRef, value: string): Promise<void> {
    this.values.set(ref.id, value);
  }

  async hasSecret(ref: SecretRef): Promise<boolean> {
    return this.values.has(ref.id);
  }

  async deleteSecret(ref: SecretRef): Promise<void> {
    this.values.delete(ref.id);
  }
}

describe('ProviderSettingsService', () => {
  let repository: MemoryProviderSettingsRepository;
  let secretStore: MemorySecretStore;

  beforeEach(() => {
    repository = new MemoryProviderSettingsRepository();
    secretStore = new MemorySecretStore();
  });

  it('initializes defaults and returns renderer-safe provider statuses', async () => {
    const service = new ProviderSettingsService({
      repository,
      secretStore,
      env: {},
    });

    const statuses = await service.listProviderStatuses();

    expect(statuses).toEqual([
      {
        providerId: 'deepseek',
        displayName: 'DeepSeek',
        enabled: true,
        baseUrl: 'https://api.deepseek.com',
        defaultModelId: 'deepseek-v4-flash',
        hasSecret: false,
        credentialSource: 'missing',
        envOverrideActive: false,
      },
      {
        providerId: 'openai',
        displayName: 'OpenAI',
        enabled: true,
        baseUrl: 'https://api.openai.com/v1',
        defaultModelId: 'gpt-5.5',
        hasSecret: false,
        credentialSource: 'missing',
        envOverrideActive: false,
      },
      {
        providerId: 'anthropic',
        displayName: 'Anthropic',
        enabled: false,
        defaultModelId: 'claude-sonnet-4-6',
        hasSecret: false,
        credentialSource: 'missing',
        envOverrideActive: false,
      },
    ]);
    expect(JSON.stringify(statuses)).not.toContain('sk-');
  });

  it('reports environment overrides without exposing values', async () => {
    const service = new ProviderSettingsService({
      repository,
      secretStore,
      env: {
        OPENAI_API_KEY: 'sk-openai-env',
      },
    });

    const openai = (await service.listProviderStatuses()).find((status) => status.providerId === 'openai');

    expect(openai).toMatchObject({
      providerId: 'openai',
      hasSecret: false,
      credentialSource: 'environment',
      envOverrideActive: true,
    });
    expect(JSON.stringify(openai)).not.toContain('sk-openai-env');
  });

  it('stores an API key and persists only its secret ref in provider settings', async () => {
    const service = new ProviderSettingsService({
      repository,
      secretStore,
      env: {},
    });

    const settings = await service.setProviderApiKey('deepseek', 'sk-deepseek');

    expect(settings.secretRef).toEqual(buildProviderApiKeySecretRef('deepseek'));
    expect(secretStore.values.get('secret:provider-api-key:deepseek')).toBe('sk-deepseek');
    expect(JSON.stringify(repository.get('deepseek'))).not.toContain('sk-deepseek');

    const deepseek = (await service.listProviderStatuses()).find((status) => status.providerId === 'deepseek');
    expect(deepseek).toMatchObject({
      hasSecret: true,
      credentialSource: 'secret-store',
      envOverrideActive: false,
    });
  });

  it('deletes API key secret and clears the provider secret ref', async () => {
    const service = new ProviderSettingsService({
      repository,
      secretStore,
      env: {},
    });

    await service.setProviderApiKey('openai', 'sk-openai');
    const settings = await service.deleteProviderApiKey('openai');

    expect(settings.secretRef).toBeUndefined();
    expect(secretStore.values.has('secret:provider-api-key:openai')).toBe(false);
  });

  it('updates non-secret provider settings', async () => {
    const service = new ProviderSettingsService({
      repository,
      secretStore,
      env: {},
    });

    const updated = await service.updateProviderSettings('deepseek', {
      enabled: false,
      baseUrl: 'https://proxy.local/deepseek',
      defaultModelId: 'deepseek-v4-pro',
    });

    expect(updated).toMatchObject({
      providerId: 'deepseek',
      enabled: false,
      baseUrl: 'https://proxy.local/deepseek',
      defaultModelId: 'deepseek-v4-pro',
    });
  });

  it('migrates legacy provider default model ids when reading settings', async () => {
    repository.settings.set('deepseek', {
      ...DEFAULT_PROVIDER_SETTINGS.deepseek,
      defaultModelId: 'deepseek-reasoner',
      createdAt: '2026-05-10T00:00:00.000Z',
      updatedAt: '2026-05-10T00:00:00.000Z',
    });
    repository.settings.set('openai', {
      ...DEFAULT_PROVIDER_SETTINGS.openai,
      defaultModelId: 'gpt-4.1',
      createdAt: '2026-05-10T00:00:00.000Z',
      updatedAt: '2026-05-10T00:00:00.000Z',
    });
    repository.settings.set('anthropic', {
      ...DEFAULT_PROVIDER_SETTINGS.anthropic,
      defaultModelId: 'claude-3-5-sonnet-latest',
      createdAt: '2026-05-10T00:00:00.000Z',
      updatedAt: '2026-05-10T00:00:00.000Z',
    });
    const service = new ProviderSettingsService({
      repository,
      secretStore,
      env: {},
    });

    const statuses = await service.listProviderStatuses();

    expect(statuses.map((status) => [status.providerId, status.defaultModelId])).toEqual([
      ['deepseek', 'deepseek-v4-flash'],
      ['openai', 'gpt-5.5'],
      ['anthropic', 'claude-sonnet-4-6'],
    ]);
  });

  it('reports plaintext config credentials before secret-store credentials', async () => {
    await secretStore.setSecret(buildProviderApiKeySecretRef('deepseek'), 'sk-secret-store');

    const service = new ProviderSettingsService({
      repository,
      secretStore,
      env: {},
      configCredentials: {
        getProviderApiKeyEnv: async () => undefined,
        getPlaintextProviderApiKey: async (providerId) => (providerId === 'deepseek' ? 'sk-config-deepseek' : null),
      },
    });

    const deepseek = (await service.listProviderStatuses()).find((status) => status.providerId === 'deepseek');

    expect(deepseek).toMatchObject({
      providerId: 'deepseek',
      hasSecret: true,
      credentialSource: 'config',
      envOverrideActive: false,
    });
    expect(JSON.stringify(deepseek)).not.toContain('sk-config-deepseek');
  });

  it('uses config-defined apiKeyEnv names for environment credential metadata', async () => {
    const service = new ProviderSettingsService({
      repository,
      secretStore,
      env: {
        CUSTOM_DEEPSEEK_KEY: 'sk-custom-env',
      },
      configCredentials: {
        getProviderApiKeyEnv: async (providerId) => (providerId === 'deepseek' ? 'CUSTOM_DEEPSEEK_KEY' : undefined),
        getPlaintextProviderApiKey: async () => null,
      },
    });

    const deepseek = (await service.listProviderStatuses()).find((status) => status.providerId === 'deepseek');

    expect(deepseek).toMatchObject({
      providerId: 'deepseek',
      credentialSource: 'environment',
      envOverrideActive: true,
    });
    expect(JSON.stringify(deepseek)).not.toContain('sk-custom-env');
  });
});

