// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as permissionsModule from '@megumi/coding-agent/permissions';

describe('Permissions module public boundary', () => {
  it('exports a single Permission Service entry and target contracts', () => {
    expect(permissionsModule.createPermissionService).toBeTypeOf('function');
    expect(permissionsModule.PermissionModeSchema).toBeDefined();
    expect(permissionsModule.PermissionDecisionSchema).toBeDefined();
    expect(permissionsModule.ApprovalDecisionSchema).toBeDefined();
  });

  it('does not expose old snapshot or split policy services as public API', () => {
    expect('PermissionSnapshotService' in permissionsModule).toBe(false);
    expect('RunPermissionSnapshot' in permissionsModule).toBe(false);
    expect('PermissionSettingsProvider' in permissionsModule).toBe(false);
  });
});
