// @vitest-environment node
/* Verifies resource-specific matching semantics for structured permission rules. */
import { describe, expect, it } from 'vitest';
import { type PermissionOperation, type PermissionRule } from '@megumi/agent/permissions';
import { matchesPermissionRule } from '../../../../packages/agent/permissions/core/permission-rule-matcher';

const context = {
  workspace_id: 'workspace_1', session_id: 'session_1', run_id: 'run_1',
  tool_identity: { registered_tool_name: 'test', source_id: 'built_in', namespace: 'megumi', source_tool_name: 'test' },
};

function operation(action: PermissionOperation['action'], type: NonNullable<PermissionOperation['resource']>['type'], id: string, attributes?: Record<string, unknown>): PermissionOperation {
  return { action, resource: { type, id, ...(attributes ? { attributes } : {}) }, context };
}

function rule(action: string, type: string, matcher: { operator: string; value?: string }): PermissionRule {
  return { source: 'user', target: { kind: 'operation', action, resource: { type, matcher } } } as PermissionRule;
}

describe('Permission rule matcher', () => {
  it('matches path prefixes only at path boundaries', () => {
    const target = rule('workspace.write', 'workspace.path', { operator: 'prefix', value: 'C:/work/src' });
    expect(matchesPermissionRule(target, operation('workspace.write', 'workspace.path', 'C:/work/src/a.ts'))).toBe(true);
    expect(matchesPermissionRule(target, operation('workspace.write', 'workspace.path', 'C:/work/src-other/a.ts'))).toBe(false);
  });

  it('matches command prefixes only at token boundaries', () => {
    const target = rule('process.execute', 'process.command', { operator: 'prefix', value: 'npm test' });
    expect(matchesPermissionRule(target, operation('process.execute', 'process.command', 'npm test -- --run'))).toBe(true);
    expect(matchesPermissionRule(target, operation('process.execute', 'process.command', 'npm tester'))).toBe(false);
  });

  it('keeps exact hostnames distinct from wildcard subdomains', () => {
    const exact = rule('network.fetch', 'network.url', { operator: 'hostname', value: 'example.com' });
    const wildcard = rule('network.fetch', 'network.url', { operator: 'hostname', value: '*.example.com' });
    expect(matchesPermissionRule(exact, operation('network.fetch', 'network.url', 'https://example.com', { hostname: 'example.com' }))).toBe(true);
    expect(matchesPermissionRule(exact, operation('network.fetch', 'network.url', 'https://api.example.com', { hostname: 'api.example.com' }))).toBe(false);
    expect(matchesPermissionRule(wildcard, operation('network.fetch', 'network.url', 'https://api.example.com', { hostname: 'api.example.com' }))).toBe(true);
    expect(matchesPermissionRule(wildcard, operation('network.fetch', 'network.url', 'https://example.com', { hostname: 'example.com' }))).toBe(false);
  });
});
