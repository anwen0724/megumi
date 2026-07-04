// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  ApplyApprovalDecisionRequestSchema,
  ApprovalRequestFactsSchema,
  ApprovalScopeSchema,
  PermissionDecisionSchema,
  PermissionModeSchema,
  PermissionRuleSchema,
  PermissionStateChangeSchema,
  RegisteredToolPermissionFactsSchema,
  RuntimeCapabilityPolicySchema,
  RuntimeErrorSchema,
  SandboxRequirementSchema,
  WorkspacePathPermissionFactsSchema,
  type PermissionSettingsApplyService,
} from '@megumi/coding-agent/permissions';

describe('Permissions module contracts', () => {
  it('validates permission rules and requires session source ids', () => {
    expect(PermissionRuleSchema.safeParse({
      source: 'session',
      source_id: 'session_1',
      pattern: 'tool:run_command|command=npm test',
    }).success).toBe(true);

    expect(PermissionRuleSchema.safeParse({
      source: 'session',
      pattern: 'tool:run_command|command=npm test',
    }).success).toBe(false);
  });

  it('accepts the architecture-defined permission modes only', () => {
    expect(PermissionModeSchema.options).toEqual(['default', 'accept_edits', 'plan', 'auto']);
    expect(PermissionModeSchema.safeParse('default').success).toBe(true);
    expect(PermissionModeSchema.safeParse('read_only').success).toBe(false);
  });

  it('requires runtime capability policy fields', () => {
    expect(RuntimeCapabilityPolicySchema.safeParse({
      custom_tools_enabled: true,
      process_execution_enabled: true,
      network_enabled: false,
    }).success).toBe(true);

    expect(RuntimeCapabilityPolicySchema.safeParse({
      custom_tools_enabled: true,
      process_execution_enabled: true,
    }).success).toBe(false);
  });

  it('accepts requires_approval decisions with once and session scopes', () => {
    expect(PermissionDecisionSchema.safeParse({
      type: 'requires_approval',
      reason: 'Workspace mutation requires approval.',
      execution_class: 'workspace_mutation',
      approval: {
        allowed_scopes: ['once', 'session'],
        default_scope: 'once',
      },
    }).success).toBe(true);
  });

  it('validates external tool and workspace facts', () => {
    expect(RegisteredToolPermissionFactsSchema.safeParse({
      registered_tool_name: 'run_command',
      source_id: 'built_in',
      source_tool_name: 'run_command',
      capabilities: ['command_run'],
      risk_level: 'high',
      side_effect: 'process_execution',
    }).success).toBe(true);

    expect(WorkspacePathPermissionFactsSchema.safeParse({
      inside_workspace: true,
      protected: false,
      sensitive: false,
      workspace_path: 'src/index.ts',
    }).success).toBe(true);
  });

  it('validates approval request facts and approval scopes', () => {
    expect(ApprovalRequestFactsSchema.safeParse({
      approval_request_id: 'approval_1',
      status: 'pending',
      subject: {
        type: 'tool_call',
        tool_call_id: 'tool_call_1',
        tool_name: 'run_command',
        input: { command: 'npm test' },
      },
      allowed_scopes: ['once', 'session'],
    }).success).toBe(true);

    expect(ApprovalScopeSchema.safeParse('once').success).toBe(true);
    expect(ApprovalScopeSchema.safeParse('session').success).toBe(true);
    expect(ApprovalScopeSchema.safeParse('workspace').success).toBe(false);
  });

  it('validates sandbox requirements and runtime errors', () => {
    expect(SandboxRequirementSchema.safeParse({
      level: 'restricted_command',
      allowed_roots: ['C:/workspace'],
      network_policy: 'deny',
    }).success).toBe(true);

    expect(RuntimeErrorSchema.safeParse({
      code: 'settings_failed',
      message: 'Settings write failed.',
      details: { source: 'test' },
    }).success).toBe(true);
  });

  it('requires session id on apply approval requests and excludes settings services', () => {
    const baseRequest = {
      session_id: 'session_1',
      approval_request: {
        approval_request_id: 'approval_1',
        status: 'pending',
        subject: {
          type: 'tool_call',
          tool_call_id: 'tool_call_1',
          tool_name: 'run_command',
          input: { command: 'npm test' },
        },
        allowed_scopes: ['once', 'session'],
      },
      original_permission_decision: {
        type: 'requires_approval',
        reason: 'Process execution requires approval.',
        execution_class: 'process_execution',
        approval: {
          allowed_scopes: ['once', 'session'],
          default_scope: 'once',
        },
      },
      decision: {
        approval_request_id: 'approval_1',
        decision: 'approved',
        scope: 'session',
        decided_by: 'user',
        decided_at: '2026-07-05T00:00:00.000Z',
      },
      applied_at: '2026-07-05T00:00:01.000Z',
    };

    expect(ApplyApprovalDecisionRequestSchema.safeParse(baseRequest).success).toBe(true);
    expect(ApplyApprovalDecisionRequestSchema.safeParse({
      ...baseRequest,
      session_id: undefined,
    }).success).toBe(false);
    expect(ApplyApprovalDecisionRequestSchema.safeParse({
      ...baseRequest,
      settings_service: {},
    }).success).toBe(false);
  });

  it('validates permission state changes with settings rules', () => {
    expect(PermissionStateChangeSchema.safeParse({
      type: 'settings_rule_change',
      rule: {
        source: 'session',
        source_id: 'session_1',
        pattern: 'tool:write_file|path=src/index.ts',
      },
    }).success).toBe(true);
  });

  it('keeps PermissionSettingsApplyService as a type-only dependency', () => {
    const service: PermissionSettingsApplyService = {
      async addPermissionRule() {
        return { status: 'saved' };
      },
    };

    expect(service.addPermissionRule).toBeTypeOf('function');
  });
});
