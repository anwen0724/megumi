import { describe, expect, it } from 'vitest';
import {
  PermissionRulePatternSchema,
  PermissionSettingsSchema,
  mergePermissionSettingsScopes,
} from '@megumi/shared/permission';

describe('permission-settings-contracts', () => {
  it('parses User / Project / Local permission settings', () => {
    const settings = PermissionSettingsSchema.parse({
      permissions: {
        allow: ['run_command(npm test)', 'read_file(README.md)'],
        ask: ['run_command(npm install *)'],
        deny: ['run_command(curl *)', 'read_file(secrets/**)'],
      },
    });

    expect(settings.permissions.allow).toEqual(['run_command(npm test)', 'read_file(README.md)']);
    expect(settings.permissions.ask).toEqual(['run_command(npm install *)']);
    expect(settings.permissions.deny).toEqual(['run_command(curl *)', 'read_file(secrets/**)']);
  });

  it('rejects invalid rule patterns and bypass-style settings', () => {
    expect(() => PermissionRulePatternSchema.parse('run_command npm test')).toThrow();
    expect(() =>
      PermissionSettingsSchema.parse({
        permissions: {
          allow: ['bypassPermissions'],
        },
      }),
    ).toThrow();
    expect(() =>
      PermissionSettingsSchema.parse({
        permissions: {
          allow: ['dontAsk'],
        },
      }),
    ).toThrow();
    expect(() =>
      PermissionSettingsSchema.parse({
        permissions: {
          allow: ['run_command(bypass_permissions)'],
        },
      }),
    ).toThrow();
  });

  it('merges scopes without dropping deny rules and preserves scope labels', () => {
    const merged = mergePermissionSettingsScopes([
      {
        scope: 'user',
        settings: { permissions: { deny: ['run_command(curl *)'] } },
      },
      {
        scope: 'project',
        settings: { permissions: { ask: ['run_command(npm install *)'] } },
      },
      {
        scope: 'local',
        settings: { permissions: { allow: ['run_command(curl https://example.com)'] } },
      },
    ]);

    expect(merged.deny).toEqual([{ scope: 'user', pattern: 'run_command(curl *)' }]);
    expect(merged.ask).toEqual([{ scope: 'project', pattern: 'run_command(npm install *)' }]);
    expect(merged.allow).toEqual([
      { scope: 'local', pattern: 'run_command(curl https://example.com)' },
    ]);
  });
});

