// @vitest-environment node
/* Verifies the stable Permissions contracts and the intentionally narrow public entry. */
import { describe, expect, it } from 'vitest';
import * as permissionsModule from '../../../packages/permissions/src/index';

const toolIdentity = {
  source_id: 'built_in',
  namespace: 'megumi',
  source_tool_name: 'run_command',
};

describe('Permissions contracts', () => {
  it('keeps the three Permission modes and strict structured rules', () => {
    expect(permissionsModule.PermissionModeSchema.options).toEqual(['ask', 'auto', 'full_access']);
    expect(permissionsModule.PermissionRuleSchema.safeParse({
      source: 'session',
      source_id: 'session_1',
      target: { kind: 'tool', tool_identity: toolIdentity },
    }).success).toBe(true);
    expect(permissionsModule.PermissionRuleSchema.safeParse({
      source: 'session',
      target: { kind: 'tool', tool_identity: toolIdentity },
    }).success).toBe(false);
  });

  it('exposes the capability entry and stable schemas without exposing internals', () => {
    expect(permissionsModule.createPermissions).toBeTypeOf('function');
    expect(permissionsModule.PermissionOperationSchema).toBeDefined();
    expect(permissionsModule.PermissionDecisionSchema).toBeDefined();
    expect(permissionsModule.ApprovalDecisionSchema).toBeDefined();
    expect(permissionsModule).not.toHaveProperty('matchesPermissionRule');
    expect(permissionsModule).not.toHaveProperty('classifyShellCommand');
    expect(permissionsModule).not.toHaveProperty('resolvePermissionOperations');
  });
});
