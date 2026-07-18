// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as permissionsModule from '@megumi/agent/permissions';

describe('Permissions module public boundary', () => {
  it('exports a single Permission Service entry and target contracts', () => {
    expect(permissionsModule.createPermissionService).toBeTypeOf('function');
    expect(permissionsModule.PermissionModeSchema).toBeDefined();
    expect(permissionsModule.PermissionDecisionSchema).toBeDefined();
    expect(permissionsModule.ApprovalDecisionSchema).toBeDefined();
  });

  it('does not expose old snapshot or split policy services as public API', () => {
    expect(['Permission', 'SnapshotService'].join('') in permissionsModule).toBe(false);
    expect(['Run', 'PermissionSnapshot'].join('') in permissionsModule).toBe(false);
    expect(['Permission', 'SettingsProvider'].join('') in permissionsModule).toBe(false);
  });
});
