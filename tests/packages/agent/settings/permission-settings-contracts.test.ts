// @vitest-environment node
/* Verifies strict Settings persistence contracts for action permissions. */
import { describe, expect, it } from 'vitest';
import {
  AddPermissionRulesRequestSchema,
  PermissionRulesRawSchema,
  PermissionRulesResolvedSchema,
} from '@megumi/agent/settings';

const rule = {
  source: 'session' as const,
  source_id: 'session_1',
  target: {
    kind: 'tool' as const,
    tool_identity: { source_id: 'built_in', namespace: 'megumi', source_tool_name: 'run_command' },
  },
};

describe('permission settings contracts', () => {
  it('stores sparse modes and structured rules without accepting legacy patterns', () => {
    expect(PermissionRulesRawSchema.parse({ mode: 'auto', allow: [rule] })).toEqual({ mode: 'auto', allow: [rule] });
    expect(PermissionRulesRawSchema.safeParse({ allow: [{ source: 'user', pattern: 'tool:run_command' }] }).success).toBe(false);
    expect(PermissionRulesResolvedSchema.parse({ mode: 'ask', allow: [], ask: [], deny: [] })).toBeTruthy();
    expect(PermissionRulesResolvedSchema.safeParse({ mode: 'custom', allow: [], ask: [], deny: [] }).success).toBe(false);
  });

  it('requires an atomic non-empty session batch and rejects unknown fields', () => {
    expect(AddPermissionRulesRequestSchema.parse({ session_id: 'session_1', rules: [rule] }).rules).toHaveLength(1);
    expect(AddPermissionRulesRequestSchema.safeParse({ session_id: 'session_1', rules: [] }).success).toBe(false);
    expect(AddPermissionRulesRequestSchema.safeParse({ session_id: 'session_1', rules: [rule], scope: 'session' }).success).toBe(false);
  });
});
