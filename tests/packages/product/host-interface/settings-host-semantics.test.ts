// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createSettings, type SettingsStore } from '@megumi/settings';
import { createSettingsHost } from '../../../../packages/product/src/host/settings-host';

describe('SettingsHost semantics', () => {
  it('forwards updates to Settings and projects the resolved Host DTO', async () => {
    const store = memoryStore();
    const host = createSettingsHost(createSettings({ store }));

    const result = await host.update({
      theme: 'midnight-blue',
      modelSelection: { providerId: 'deepseek', modelId: 'deepseek-chat' },
    });

    expect(result).toMatchObject({
      status: 'updated',
      settings: {
        theme: 'midnight-blue',
        modelSelection: { providerId: 'deepseek', modelId: 'deepseek-chat' },
      },
    });
  });

  it('keeps provider credentials out of list responses', async () => {
    const store = memoryStore({
      providers: {
        deepseek: {
          enabled: true,
          api: 'openai-completions',
          base_url: 'https://api.example.com/v1',
          models: { 'deepseek-chat': {} },
          api_key: 'secret-value',
        },
      },
    });
    const host = createSettingsHost(createSettings({ store }));

    const result = await host.listProviders();

    expect(result.status).toBe('ok');
    expect(JSON.stringify(result)).not.toContain('secret-value');
  });
});

function memoryStore(initial: Record<string, unknown> = {}): SettingsStore {
  let value = initial;
  return {
    read: () => value,
    write: (next) => { value = { ...next }; },
  };
}
