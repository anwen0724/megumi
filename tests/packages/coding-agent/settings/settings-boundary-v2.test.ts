// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as settingsModule from '@megumi/coding-agent/settings';

describe('Settings module public boundary', () => {
  it('exports a single Settings Service entry and target contracts', () => {
    expect(settingsModule.createSettingsService).toBeTypeOf('function');
    expect(settingsModule.SettingsRawSchema).toBeDefined();
    expect(settingsModule.ProviderSettingsRawSchema).toBeDefined();
    expect(settingsModule.PermissionRuleSchema).toBeDefined();
  });

  it('does not expose old split service constructors as public API', () => {
    expect('ProductSettingsService' in settingsModule).toBe(false);
    expect('ProviderSettingsService' in settingsModule).toBe(false);
    expect('ProviderRuntimeService' in settingsModule).toBe(false);
  });
});
