// @vitest-environment node
/* Verifies the one-time Product migration without teaching Settings the legacy DSL. */
import { describe, expect, it } from 'vitest';
import {
  LegacyPermissionSettingsMigrationError,
  migrateLegacyPermissionSettings,
} from '@megumi/product/migrations/legacy-permission-settings';

describe('legacy permission settings migration', () => {
  it('migrates session patterns to stable tool grants and path rules to operations', () => {
    const result = migrateLegacyPermissionSettings({ permissions: { allow: [
      { source: 'session', source_id: 'session_1', pattern: 'tool:web_fetch|url=https://example.com/*' },
      { source: 'user', pattern: 'tool:write_file|path=src/*' },
    ] } });
    expect(result).toMatchObject({ migrated: true, settings: { permissions: { allow: [
      { source: 'session', target: { kind: 'tool', tool_identity: { source_tool_name: 'web_fetch' } } },
      { source: 'user', target: { kind: 'operation', action: 'workspace.write', resource: { matcher: { operator: 'prefix', value: 'src/' } } } },
    ] } } });
  });

  it('fails rather than widening an ambiguous legacy rule', () => {
    expect(() => migrateLegacyPermissionSettings({ permissions: { allow: [
      { source: 'user', pattern: 'tool:web_fetch|url=https://example.com/*' },
    ] } })).toThrow(LegacyPermissionSettingsMigrationError);
  });

  it('leaves already structured settings untouched', () => {
    const value = { permissions: { mode: 'ask', allow: [] } };
    expect(migrateLegacyPermissionSettings(value)).toEqual({ migrated: false, settings: value });
  });

  it('migrates the removed custom mode to its effective fallback', () => {
    expect(migrateLegacyPermissionSettings({ permissions: {
      mode: 'custom', custom_fallback: 'auto', allow: [], ask: [], deny: [],
    } })).toEqual({ migrated: true, settings: { permissions: {
      mode: 'auto', allow: [], ask: [], deny: [],
    } } });
  });
});
