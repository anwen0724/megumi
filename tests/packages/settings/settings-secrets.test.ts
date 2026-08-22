/* Verifies Settings keeps file secrets out of ordinary public models and updates. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  createSettings,
  type SettingsStore,
} from '../../../packages/settings/src';

class MemorySettingsStore implements SettingsStore {
  constructor(public document: unknown = {}) {}

  read(): unknown {
    return structuredClone(this.document);
  }

  write(next: Readonly<Record<string, unknown>>): void {
    this.document = structuredClone(next);
  }
}

describe('Settings secret boundary', () => {
  it('keeps Provider and Web Search keys out of read and resolve results', () => {
    const store = new MemorySettingsStore({
      providers: {
        local: {
          api: 'openai-completions',
          base_url: 'http://localhost:11434/v1',
          models: { llama3: {} },
          api_key: 'provider-secret',
        },
      },
      web: { search: { provider: 'tavily', api_key: 'web-secret' } },
    });
    const settings = createSettings({ store });

    expect(JSON.stringify(settings.read())).not.toContain('provider-secret');
    expect(JSON.stringify(settings.read())).not.toContain('web-secret');
    expect(JSON.stringify(settings.resolve())).not.toContain('provider-secret');
    expect(JSON.stringify(settings.resolve())).not.toContain('web-secret');
    expect(settings.listProviders()).toMatchObject({
      status: 'ok',
      providers: [{ provider_id: 'local', has_api_key: true, credential_source: 'settings' }],
    });
    expect(JSON.stringify(settings.listProviders())).not.toContain('provider-secret');
  });

  it('preserves existing keys during ordinary sparse updates', () => {
    const store = new MemorySettingsStore({
      providers: { deepseek: { api_key: 'provider-secret' } },
      web: { search: { api_key: 'web-secret' } },
    });
    const settings = createSettings({ store });

    expect(settings.update({ patch: { theme: 'rose-moon' } })).toMatchObject({ status: 'updated' });
    expect(store.document).toMatchObject({
      theme: 'rose-moon',
      providers: { deepseek: { api_key: 'provider-secret' } },
      web: { search: { api_key: 'web-secret' } },
    });
    expect(settings.update({ patch: {
      providers: { deepseek: { api_key: 'ordinary-update-must-fail' } },
    } } as never)).toMatchObject({
      status: 'failed',
      failure: { code: 'config_invalid', details: { settings_code: 'settings_patch_invalid' } },
    });
    expect(JSON.stringify(store.document)).not.toContain('ordinary-update-must-fail');
  });

  it('uses six explicit methods for Provider and Web Search key lifecycle', () => {
    const store = new MemorySettingsStore();
    const settings = createSettings({ store });

    expect(settings.writeProviderApiKey({ provider_id: 'deepseek', api_key: 'provider-secret' }))
      .toEqual({ status: 'updated' });
    expect(settings.readProviderApiKey({ provider_id: 'deepseek' }))
      .toEqual({ status: 'found', api_key: 'provider-secret', source: 'settings' });
    expect(settings.deleteProviderApiKey({ provider_id: 'deepseek' }))
      .toEqual({ status: 'deleted' });
    expect(settings.readProviderApiKey({ provider_id: 'deepseek' })).toEqual({ status: 'missing' });

    expect(settings.writeWebSearchApiKey({ api_key: 'web-secret' })).toEqual({ status: 'updated' });
    expect(settings.readWebSearchApiKey({})).toEqual({
      status: 'found', api_key: 'web-secret', source: 'settings',
    });
    expect(settings.deleteWebSearchApiKey({})).toEqual({ status: 'deleted' });
    expect(settings.readWebSearchApiKey({})).toEqual({ status: 'missing' });
  });
});
