// @vitest-environment node
/* Verifies validation of session-scoped permission rules. */
import { describe, expect, it } from 'vitest';
import * as permissionsModule from '@megumi/agent-runtime/permissions/index';

const toolIdentity = {
  source_id: 'built_in',
  namespace: 'megumi',
  source_tool_name: 'run_command',
};

describe('Permissions contracts', () => {
  it('requires the owning session identity in a session-scoped rule', () => {
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
});
