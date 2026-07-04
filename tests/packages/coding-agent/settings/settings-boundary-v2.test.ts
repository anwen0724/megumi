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
    const oldConstructors = [
      ['Product', 'Settings', 'Service'],
      ['Provider', 'Settings', 'Service'],
      ['Provider', 'Runtime', 'Service'],
    ].map((parts) => parts.join(''));

    for (const constructorName of oldConstructors) {
      expect(constructorName in settingsModule).toBe(false);
    }
  });
});
