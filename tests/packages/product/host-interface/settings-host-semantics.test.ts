import { describe, expect, it, vi } from 'vitest';
import { createSettingsHost } from '@megumi/product/host-interface/settings-host';

describe('SettingsHost semantics', () => {
  it('projects owner failures instead of throwing Error(message)', async () => {
    const host = createSettingsHost({
      getResolvedSettings: vi.fn(() => ({
        status: 'failed' as const,
        failure: { code: 'settings_invalid', message: 'Settings are invalid.', retryable: false },
      })),
    } as never);

    await expect(host.get()).resolves.toEqual({
      status: 'failed',
      failure: { code: 'settings_invalid', message: 'Settings are invalid.', retryable: false },
    });
  });

  it('does not drop schema-accepted empty provider fields during patch mapping', async () => {
    const updateProviderSettings = vi.fn(() => ({ status: 'ok' as const }));
    const host = createSettingsHost({
      updateProviderSettings,
    } as never);

    await host.updateProvider({
      providerId: 'provider:1',
      displayName: '',
      baseUrl: '',
      modelIds: [],
    });

    expect(updateProviderSettings).toHaveBeenCalledWith({
      provider_id: 'provider:1',
      patch: {
        display_name: '',
        base_url: '',
        models: [],
      },
    });
  });
});
