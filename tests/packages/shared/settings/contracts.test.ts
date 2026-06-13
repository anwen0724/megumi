import { describe, expect, it } from 'vitest';
import {
  AppSettingsRawSchema,
  DEFAULT_APP_SETTINGS,
  resolveAppSettings,
} from '@megumi/shared/settings';

describe('app settings contracts', () => {
  it('resolves missing user settings from defaults without requiring a full settings file', () => {
    expect(resolveAppSettings({})).toEqual(DEFAULT_APP_SETTINGS);
    expect(resolveAppSettings({ theme: 'graphite-dark' })).toEqual({
      ...DEFAULT_APP_SETTINGS,
      theme: 'graphite-dark',
    });
    expect(resolveAppSettings({
      compaction: {
        reserveTokens: 32768,
      },
    })).toEqual({
      ...DEFAULT_APP_SETTINGS,
      compaction: {
        ...DEFAULT_APP_SETTINGS.compaction,
        reserveTokens: 32768,
      },
    });
  });

  it('keeps raw settings partial so disk files only express user overrides', () => {
    expect(AppSettingsRawSchema.parse({
      memory: {
        enabled: true,
      },
    })).toEqual({
      memory: {
        enabled: true,
      },
    });
  });
});
