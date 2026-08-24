/* Verifies the Settings Package exports only stable secret-free contracts. */
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as settingsModule from '../../../packages/agent/settings/src';

describe('Settings public boundary', () => {
  it('exports one Settings capability and stable public schemas', () => {
    expect(settingsModule.createSettings).toBeTypeOf('function');
    expect(settingsModule.SettingsRawSchema).toBeDefined();
    expect(settingsModule.ProviderSettingsRawSchema).toBeDefined();
    expect(settingsModule.PermissionRuleSchema).toBeDefined();
  });

  it('does not expose legacy Service constructors or secret-bearing file models', () => {
    for (const exportName of [
      'createSettingsService',
      'SettingsService',
      'ProductSettingsService',
      'ProviderSettingsService',
      'ProviderRuntimeService',
      'createSettingsStore',
      'SettingsStoreParseError',
      'SettingsFileRaw',
      'SettingsFileRawSchema',
      'ProviderSettingsFileRawSchema',
      'WebSearchSettingsFileRawSchema',
    ]) {
      expect(exportName in settingsModule, exportName).toBe(false);
    }
  });

  it('depends only on AI and Permissions business contracts', () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), 'packages/agent/settings/package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(manifest.dependencies).toHaveProperty('@megumi/ai');
    expect(manifest.dependencies).toHaveProperty('@megumi/permissions');
    expect(manifest.dependencies).not.toHaveProperty('@megumi/events');
  });

  it('does not expose resolution and merge implementation helpers', () => {
    for (const exportName of [
      'resolvePublicSettings',
      'mergeFileWithPublicPatch',
      'materializeFileForWrite',
      'resolveProviderSettings',
      'readProviderCredential',
    ]) {
      expect(exportName in settingsModule, exportName).toBe(false);
    }
  });
});
