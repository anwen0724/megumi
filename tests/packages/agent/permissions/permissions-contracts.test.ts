// @vitest-environment node
/* Verifies the public Agent Action Permissions contracts. */
import { describe, expect, it } from 'vitest';
import {
  ApplyApprovalDecisionRequestSchema,
  ApprovalDecisionSchema,
  PermissionDecisionSchema,
  PermissionModeSchema,
  PermissionOperationSchema,
  PermissionRuleSchema,
  SafetyAssessmentSchema,
  type PermissionSettingsApplyService,
} from '@megumi/agent/permissions';

const toolIdentity = {
  source_id: 'built_in',
  namespace: 'megumi',
  source_tool_name: 'run_command',
};

describe('Agent Action Permissions contracts', () => {
  it('accepts only the three approval modes and three safety assessments', () => {
    expect(PermissionModeSchema.options).toEqual(['ask', 'auto', 'full_access']);
    expect(SafetyAssessmentSchema.options).toEqual(['safe', 'potentially_unsafe', 'prohibited']);
    expect(PermissionModeSchema.safeParse('default').success).toBe(false);
    expect(PermissionModeSchema.safeParse('plan').success).toBe(false);
    expect(PermissionModeSchema.safeParse('custom').success).toBe(false);
  });

  it('validates action resource context operations strictly', () => {
    const operation = {
      action: 'process.execute',
      resource: { type: 'process.command', id: 'npm test' },
      context: {
        workspace_id: 'workspace_1', session_id: 'session_1', run_id: 'run_1',
        tool_identity: { ...toolIdentity, registered_tool_name: 'run_command' },
      },
    };
    expect(PermissionOperationSchema.parse(operation)).toEqual(operation);
    expect(PermissionOperationSchema.safeParse({ ...operation, unknown: true }).success).toBe(false);
  });

  it('separates operation rules from stable tool identity grants', () => {
    expect(PermissionRuleSchema.safeParse({
      source: 'workspace', source_id: 'workspace_1',
      target: {
        kind: 'operation', action: 'workspace.write',
        resource: { type: 'workspace.path', matcher: { operator: 'glob', value: 'src/**' } },
      },
    }).success).toBe(true);
    expect(PermissionRuleSchema.safeParse({
      source: 'session', source_id: 'session_1',
      target: { kind: 'tool', tool_identity: toolIdentity },
    }).success).toBe(true);
    expect(PermissionRuleSchema.safeParse({
      source: 'session',
      target: { kind: 'tool', tool_identity: toolIdentity },
    }).success).toBe(false);
    expect(PermissionRuleSchema.safeParse({ source: 'user', pattern: 'tool:run_command|command=npm test' }).success).toBe(false);
  });

  it('rejects unknown actions, resources, attributes, and incompatible matchers', () => {
    expect(PermissionRuleSchema.safeParse({
      source: 'user', target: { kind: 'operation', action: 'unknown.action' },
    }).success).toBe(false);
    expect(PermissionRuleSchema.safeParse({
      source: 'user', target: { kind: 'operation', action: 'workspace.write', resource: {
        type: 'network.url', matcher: { operator: 'hostname', value: 'example.com' },
      } },
    }).success).toBe(false);
    expect(PermissionRuleSchema.safeParse({
      source: 'user', target: { kind: 'operation', action: 'workspace.write', resource: {
        type: 'workspace.path', matcher: { operator: 'hostname', value: 'example.com' },
      } },
    }).success).toBe(false);
    const operation = {
      action: 'network.fetch',
      resource: { type: 'network.url', id: 'https://example.com', attributes: { hostname: 'example.com', private: false } },
      context: {
        workspace_id: 'workspace_1', session_id: 'session_1', run_id: 'run_1',
        tool_identity: { ...toolIdentity, registered_tool_name: 'web_fetch' },
      },
    };
    expect(PermissionOperationSchema.safeParse(operation).success).toBe(false);
  });

  it('validates approval decisions with immutable options', () => {
    const operation = PermissionOperationSchema.parse({
      action: 'process.execute', resource: { type: 'process.command', id: 'npm test' },
      context: {
        workspace_id: 'workspace_1', session_id: 'session_1', run_id: 'run_1',
        tool_identity: { ...toolIdentity, registered_tool_name: 'run_command' },
      },
    });
    const decision = PermissionDecisionSchema.parse({
      type: 'requires_approval', operations: [operation], safety_assessment: 'potentially_unsafe',
      reason: 'Command requires approval.', default_option_id: 'once',
      options: [
        { option_id: 'once', scope: 'once', display: { label: 'Once', description: 'Current call only.' }, effect: { type: 'current_tool_call' } },
        { option_id: 'session', scope: 'session', display: { label: 'Session', description: 'Use this tool in this session.' }, effect: {
          type: 'session_tool_grant', rule: { source: 'session', source_id: 'session_1', target: { kind: 'tool', tool_identity: toolIdentity } },
        } },
      ],
    });
    expect(decision.type).toBe('requires_approval');
    expect(ApplyApprovalDecisionRequestSchema.safeParse({
      original_permission_decision: decision,
      decision: { approval_request_id: 'approval_1', decision: 'approved', option_id: 'session', decided_by: 'user', decided_at: '2026-07-19T00:00:00.000Z' },
      session_id: 'session_1', applied_at: '2026-07-19T00:00:00.000Z',
    }).success).toBe(true);
    expect(ApprovalDecisionSchema.safeParse({
      approval_request_id: 'approval_1', decision: 'approved', decided_by: 'user', decided_at: '2026-07-19T00:00:00.000Z',
    }).success).toBe(false);
    expect(ApprovalDecisionSchema.safeParse({
      approval_request_id: 'approval_1', decision: 'denied', option_id: 'once', decided_by: 'user', decided_at: '2026-07-19T00:00:00.000Z',
    }).success).toBe(false);
  });

  it('exposes a batch-only Settings apply port', () => {
    const service: PermissionSettingsApplyService = {
      async addPermissionRules() { return { status: 'saved' }; },
    };
    expect(service.addPermissionRules).toBeTypeOf('function');
    expect(service).not.toHaveProperty('addPermissionRule');
  });
});
