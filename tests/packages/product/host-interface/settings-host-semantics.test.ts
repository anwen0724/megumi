// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createSettings, type SettingsStore } from '@megumi/settings';
import { createSettingsOperations } from '../../../../packages/product/src/operations/settings-operations';

describe('SettingsHost semantics', () => {
  it('forwards updates to Settings and projects the resolved Host DTO', async () => {
    const store = memoryStore();
    const host = createSettingsOperations(createSettings({ store }));

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
    const host = createSettingsOperations(createSettings({ store }));

    const result = await host.listProviders();

    expect(result.status).toBe('ok');
    expect(JSON.stringify(result)).not.toContain('secret-value');
  });

  it('reports unreadable settings as a structured failure instead of throwing', async () => {
    const host = createSettingsOperations(createSettings({ store: memoryStore({ providers: 'not-an-object' }) }));

    const result = await host.get();

    expect(result).toMatchObject({
      status: 'failed',
      failure: expect.objectContaining({ retryable: false }),
    });
  });

  it('reports unknown file keys as diagnostics on the ok response', async () => {
    const host = createSettingsOperations(createSettings({
      store: memoryStore({
        theme: 'sage-mist',
        custom_field: true,
        providers: { deepseek: { enabled: true, api: 'openai-completions', extra: 1 } },
        web: { search: { provider: 'tavily', note: 'x' } },
      }),
    }));

    const result = await host.get();

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.unknownKeys).toEqual([
      'custom_field',
      'providers.deepseek.extra',
      'web.search.note',
    ]);
  });
});

function memoryStore(initial: Record<string, unknown> = {}): SettingsStore {
  let value = initial;
  return {
    read: () => value,
    write: (next) => { value = { ...next }; },
  };
}
