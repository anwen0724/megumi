// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  createPermissionService,
  type ApprovalDecision,
  type ApprovalRequestFacts,
  type EvaluateToolExecutionRequest,
  type PermissionDecision,
  type PermissionMode,
  type PermissionRule,
  type RegisteredToolPermissionFacts,
  type RuntimeCapabilityPolicy,
} from '@megumi/coding-agent/permissions';

class FakeSettingsApplyService {
  requests: unknown[] = [];
  failure?: { code: string; message: string };

  async addPermissionRule(request: unknown) {
    this.requests.push(request);
    if (this.failure) {
      return { status: 'failed' as const, failure: this.failure };
    }
    return { status: 'saved' as const };
  }
}

describe('Permission Service', () => {
  describe('evaluateToolExecution', () => {
    it('denies missing registered tools', async () => {
      const service = createPermissionService({ settings_service: new FakeSettingsApplyService() });

      const result = await service.evaluateToolExecution(baseEvaluateRequest({
        registered_tool: undefined,
      }));

      expect(result).toEqual({
        status: 'ok',
        decision: expect.objectContaining({
          type: 'deny',
          denial_code: 'tool_not_found',
        }),
      });
    });

    it('denies process execution when the runtime capability is disabled', async () => {
      const service = createPermissionService({ settings_service: new FakeSettingsApplyService() });

      const result = await service.evaluateToolExecution(baseEvaluateRequest({
        registered_tool: registeredTool({
          capabilities: ['command_run'],
          risk_level: 'high',
          side_effect: 'process_execution',
        }),
        runtime_capability_policy: {
          custom_tools_enabled: true,
          process_execution_enabled: false,
          network_enabled: true,
        },
      }));

      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.decision).toMatchObject({
          type: 'deny',
          denial_code: 'capability_disabled',
          execution_class: 'process_execution',
        });
      }
    });

    it('denies workspace paths outside the workspace', async () => {
      const service = createPermissionService({ settings_service: new FakeSettingsApplyService() });

      const result = await service.evaluateToolExecution(baseEvaluateRequest({
        registered_tool: registeredTool({
          registered_tool_name: 'write_file',
          source_tool_name: 'write_file',
          capabilities: ['project_write'],
          risk_level: 'medium',
          side_effect: 'project_file_operation',
        }),
        workspace_path: {
          inside_workspace: false,
          protected: false,
          sensitive: false,
        },
      }));

      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.decision).toMatchObject({
          type: 'deny',
          denial_code: 'outside_workspace',
        });
      }
    });

    it('requires approval for workspace mutations under the conservative baseline without allow rules', async () => {
      const service = createPermissionService({ settings_service: new FakeSettingsApplyService() });

      const result = await service.evaluateToolExecution(baseEvaluateRequest({
        tool_name: 'write_file',
        tool_input: { path: 'src/index.ts', content: 'export {};' },
        registered_tool: registeredTool({
          registered_tool_name: 'write_file',
          source_tool_name: 'write_file',
          capabilities: ['project_write'],
          risk_level: 'medium',
          side_effect: 'project_file_operation',
        }),
        workspace_path: {
          inside_workspace: true,
          protected: false,
          sensitive: false,
          workspace_path: 'src/index.ts',
        },
      }));

      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.decision).toMatchObject({
          type: 'requires_approval',
          approval: {
            allowed_scopes: ['once', 'session'],
            default_scope: 'once',
          },
        });
      }
    });

    it('allows tool execution when settings allow an exact command pattern', async () => {
      const service = createPermissionService({ settings_service: new FakeSettingsApplyService() });

      const result = await service.evaluateToolExecution(baseEvaluateRequest({
        permission_settings: settings({
          allow: [{ source: 'user', pattern: 'tool:run_command|command=npm test' }],
        }),
      }));

      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.decision).toMatchObject({ type: 'allow' });
      }
    });

    it('allows tool execution when settings allow a trailing wildcard command pattern', async () => {
      const service = createPermissionService({ settings_service: new FakeSettingsApplyService() });

      const result = await service.evaluateToolExecution(baseEvaluateRequest({
        permission_settings: settings({
          allow: [{ source: 'user', pattern: 'tool:run_command|command=npm*' }],
        }),
      }));

      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.decision).toMatchObject({ type: 'allow' });
      }
    });

    it('denies tool execution when settings deny a matching destructive command pattern', async () => {
      const service = createPermissionService({ settings_service: new FakeSettingsApplyService() });

      const result = await service.evaluateToolExecution(baseEvaluateRequest({
        tool_input: { command: 'rm -rf node_modules' },
        permission_settings: settings({
          deny: [{ source: 'user', pattern: 'tool:run_command|command=rm -rf*' }],
        }),
      }));

      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.decision).toMatchObject({
          type: 'deny',
          denial_code: 'rule_denied',
        });
      }
    });

    it('treats missing permission settings as empty rule lists', async () => {
      const service = createPermissionService({ settings_service: new FakeSettingsApplyService() });

      const result = await service.evaluateToolExecution(baseEvaluateRequest({
        permission_settings: undefined,
      }));

      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.decision.type).toBe('requires_approval');
      }
    });

    it('allows activate_skill as a low-risk built-in runtime context tool', async () => {
      const service = createPermissionService({ settings_service: new FakeSettingsApplyService() });

      const result = await service.evaluateToolExecution(baseEvaluateRequest({
        tool_name: 'activate_skill',
        tool_input: { skillId: 'superpowers:brainstorming' },
        registered_tool: registeredTool({
          registered_tool_name: 'activate_skill',
          source_tool_name: 'activate_skill',
          capabilities: ['project_read'],
          risk_level: 'low',
          side_effect: 'none',
        }),
      }));

      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.decision).toMatchObject({
          type: 'allow',
          execution_class: 'read_only',
        });
      }
    });

    it('treats missing workspace path facts as no workspace path restriction', async () => {
      const service = createPermissionService({ settings_service: new FakeSettingsApplyService() });

      const result = await service.evaluateToolExecution(baseEvaluateRequest({
        tool_name: 'write_file',
        tool_input: { path: 'src/index.ts', content: 'export {};' },
        registered_tool: registeredTool({
          registered_tool_name: 'write_file',
          source_tool_name: 'write_file',
          capabilities: ['project_write'],
          risk_level: 'medium',
          side_effect: 'project_file_operation',
        }),
        workspace_path: undefined,
      }));

      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.decision.type).toBe('requires_approval');
      }
    });

    it('uses the same conservative V1 baseline for all permission modes', async () => {
      const service = createPermissionService({ settings_service: new FakeSettingsApplyService() });
      const modes: PermissionMode[] = ['default', 'accept_edits', 'plan', 'auto'];

      for (const permission_mode of modes) {
        const result = await service.evaluateToolExecution(baseEvaluateRequest({
          permission_mode,
          tool_name: 'write_file',
          tool_input: { path: 'src/index.ts', content: 'export {};' },
          registered_tool: registeredTool({
            registered_tool_name: 'write_file',
            source_tool_name: 'write_file',
            capabilities: ['project_write'],
            risk_level: 'medium',
            side_effect: 'project_file_operation',
          }),
        }));

        expect(result.status).toBe('ok');
        if (result.status === 'ok') {
          expect(result.decision.type).toBe('requires_approval');
        }
      }
    });
  });

  describe('validateApprovalDecision', () => {
    it('accepts pending matching approvals for runs waiting on approval', async () => {
      const service = createPermissionService({ settings_service: new FakeSettingsApplyService() });

      const result = await service.validateApprovalDecision({
        approval_request: approvalRequest(),
        original_permission_decision: requiresApprovalDecision(),
        decision: approvalDecision(),
        current_run_status: 'waiting_for_approval',
        validated_at: '2026-07-05T00:00:00.000Z',
      });

      expect(result).toEqual({ status: 'accepted' });
    });

    it('rejects non-pending approval requests', async () => {
      const service = createPermissionService({ settings_service: new FakeSettingsApplyService() });

      const result = await service.validateApprovalDecision({
        approval_request: approvalRequest({ status: 'approved' }),
        original_permission_decision: requiresApprovalDecision(),
        decision: approvalDecision(),
        current_run_status: 'waiting_for_approval',
        validated_at: '2026-07-05T00:00:00.000Z',
      });

      expect(result).toMatchObject({
        status: 'rejected',
        reason: 'approval_request_not_pending',
      });
    });

    it('rejects runs that are no longer waiting for approval', async () => {
      const service = createPermissionService({ settings_service: new FakeSettingsApplyService() });

      const result = await service.validateApprovalDecision({
        approval_request: approvalRequest(),
        original_permission_decision: requiresApprovalDecision(),
        decision: approvalDecision(),
        current_run_status: 'running',
        validated_at: '2026-07-05T00:00:00.000Z',
      });

      expect(result).toMatchObject({
        status: 'rejected',
        reason: 'run_not_waiting_for_approval',
      });
    });

    it('rejects approval scopes that were not allowed by the request', async () => {
      const service = createPermissionService({ settings_service: new FakeSettingsApplyService() });

      const result = await service.validateApprovalDecision({
        approval_request: approvalRequest({ allowed_scopes: ['once'] }),
        original_permission_decision: requiresApprovalDecision(),
        decision: approvalDecision({ scope: 'session' }),
        current_run_status: 'waiting_for_approval',
        validated_at: '2026-07-05T00:00:00.000Z',
      });

      expect(result).toMatchObject({
        status: 'rejected',
        reason: 'approval_scope_not_allowed',
      });
    });

    it('rejects attempts to approve an original deny decision', async () => {
      const service = createPermissionService({ settings_service: new FakeSettingsApplyService() });

      const result = await service.validateApprovalDecision({
        approval_request: approvalRequest(),
        original_permission_decision: {
          type: 'deny',
          reason: 'Destructive command denied.',
          execution_class: 'process_execution',
          denial_code: 'destructive_command',
        },
        decision: approvalDecision(),
        current_run_status: 'waiting_for_approval',
        validated_at: '2026-07-05T00:00:00.000Z',
      });

      expect(result).toMatchObject({
        status: 'rejected',
        reason: 'decision_not_allowed',
      });
    });
  });

  describe('applyApprovalDecision', () => {
    it('does not write settings for denied decisions', async () => {
      const settingsService = new FakeSettingsApplyService();
      const service = createPermissionService({ settings_service: settingsService });

      const result = await service.applyApprovalDecision({
        session_id: 'session_1',
        approval_request: approvalRequest(),
        original_permission_decision: requiresApprovalDecision(),
        decision: approvalDecision({ decision: 'denied', scope: 'once' }),
        applied_at: '2026-07-05T00:00:01.000Z',
      });

      expect(result).toEqual({
        status: 'applied',
        permission_state_change: { type: 'none' },
      });
      expect(settingsService.requests).toEqual([]);
    });

    it('does not write settings for once scope approvals', async () => {
      const settingsService = new FakeSettingsApplyService();
      const service = createPermissionService({ settings_service: settingsService });

      const result = await service.applyApprovalDecision({
        session_id: 'session_1',
        approval_request: approvalRequest(),
        original_permission_decision: requiresApprovalDecision(),
        decision: approvalDecision({ scope: 'once' }),
        applied_at: '2026-07-05T00:00:01.000Z',
      });

      expect(result).toEqual({
        status: 'applied',
        permission_state_change: { type: 'none' },
      });
      expect(settingsService.requests).toEqual([]);
    });

    it('writes session command rules through Settings Service for session scope approvals', async () => {
      const settingsService = new FakeSettingsApplyService();
      const service = createPermissionService({ settings_service: settingsService });

      const result = await service.applyApprovalDecision({
        session_id: 'session_1',
        approval_request: approvalRequest(),
        original_permission_decision: requiresApprovalDecision(),
        decision: approvalDecision({ scope: 'session' }),
        applied_at: '2026-07-05T00:00:01.000Z',
      });

      expect(result).toEqual({
        status: 'applied',
        permission_state_change: {
          type: 'settings_rule_change',
          rule: {
            source: 'session',
            source_id: 'session_1',
            pattern: 'tool:run_command|command=npm test',
          },
        },
      });
      expect(settingsService.requests).toEqual([{
        rule: {
          source: 'session',
          source_id: 'session_1',
          pattern: 'tool:run_command|command=npm test',
        },
        session_id: 'session_1',
        applied_at: '2026-07-05T00:00:01.000Z',
      }]);
    });

    it('writes session path rules for write_file approvals', async () => {
      const settingsService = new FakeSettingsApplyService();
      const service = createPermissionService({ settings_service: settingsService });

      const result = await service.applyApprovalDecision({
        session_id: 'session_1',
        approval_request: approvalRequest({
          subject: {
            type: 'tool_call',
            tool_call_id: 'tool_call_1',
            tool_name: 'write_file',
            input: { path: 'src/index.ts', content: 'export {};' },
          },
        }),
        original_permission_decision: requiresApprovalDecision({
          execution_class: 'workspace_mutation',
        }),
        decision: approvalDecision({ scope: 'session' }),
        applied_at: '2026-07-05T00:00:01.000Z',
      });

      expect(result).toMatchObject({
        status: 'applied',
        permission_state_change: {
          type: 'settings_rule_change',
          rule: {
            source: 'session',
            source_id: 'session_1',
            pattern: 'tool:write_file|path=src/index.ts',
          },
        },
      });
    });

    it('fails when session scope cannot extract stable primary input', async () => {
      const settingsService = new FakeSettingsApplyService();
      const service = createPermissionService({ settings_service: settingsService });

      const result = await service.applyApprovalDecision({
        session_id: 'session_1',
        approval_request: approvalRequest({
          subject: {
            type: 'tool_call',
            tool_call_id: 'tool_call_1',
            tool_name: 'custom_tool',
            input: { nested: { value: true } },
          },
        }),
        original_permission_decision: requiresApprovalDecision({
          execution_class: 'custom_tool',
        }),
        decision: approvalDecision({ scope: 'session' }),
        applied_at: '2026-07-05T00:00:01.000Z',
      });

      expect(result).toMatchObject({
        status: 'failed',
        failure: {
          code: 'stable_permission_rule_unavailable',
        },
      });
      expect(settingsService.requests).toEqual([]);
    });

    it('returns failed when Settings Service fails to save a session rule', async () => {
      const settingsService = new FakeSettingsApplyService();
      settingsService.failure = {
        code: 'settings_write_failed',
        message: 'Settings write failed.',
      };
      const service = createPermissionService({ settings_service: settingsService });

      const result = await service.applyApprovalDecision({
        session_id: 'session_1',
        approval_request: approvalRequest(),
        original_permission_decision: requiresApprovalDecision(),
        decision: approvalDecision({ scope: 'session' }),
        applied_at: '2026-07-05T00:00:01.000Z',
      });

      expect(result).toEqual({
        status: 'failed',
        failure: {
          code: 'settings_write_failed',
          message: 'Settings write failed.',
        },
      });
    });
  });
});

function baseEvaluateRequest(overrides: Partial<EvaluateToolExecutionRequest> = {}): EvaluateToolExecutionRequest {
  return {
    run_id: 'run_1',
    tool_call_id: 'tool_call_1',
    tool_name: 'run_command',
    tool_input: { command: 'npm test' },
    registered_tool: registeredTool(),
    permission_mode: 'default' as const,
    permission_settings: settings(),
    workspace_path: {
      inside_workspace: true,
      protected: false,
      sensitive: false,
    },
    runtime_capability_policy: runtimeCapabilityPolicy(),
    evaluated_at: '2026-07-05T00:00:00.000Z',
    ...overrides,
  };
}

function registeredTool(overrides: Partial<RegisteredToolPermissionFacts> = {}): RegisteredToolPermissionFacts {
  return {
    registered_tool_name: 'run_command',
    source_id: 'built_in',
    source_tool_name: 'run_command',
    capabilities: ['command_run'],
    risk_level: 'high',
    side_effect: 'process_execution',
    ...overrides,
  };
}

function runtimeCapabilityPolicy(overrides: Partial<RuntimeCapabilityPolicy> = {}): RuntimeCapabilityPolicy {
  return {
    custom_tools_enabled: true,
    process_execution_enabled: true,
    network_enabled: true,
    ...overrides,
  };
}

function settings(overrides: Partial<{
  allow: PermissionRule[];
  ask: PermissionRule[];
  deny: PermissionRule[];
}> = {}) {
  return {
    allow: [],
    ask: [],
    deny: [],
    ...overrides,
  };
}

function approvalRequest(overrides: Partial<ApprovalRequestFacts> = {}): ApprovalRequestFacts {
  return {
    approval_request_id: 'approval_1',
    status: 'pending',
    subject: {
      type: 'tool_call',
      tool_call_id: 'tool_call_1',
      tool_name: 'run_command',
      input: { command: 'npm test' },
    },
    allowed_scopes: ['once', 'session'],
    ...overrides,
  };
}

function approvalDecision(overrides: Partial<ApprovalDecision> = {}): ApprovalDecision {
  return {
    approval_request_id: 'approval_1',
    decision: 'approved',
    scope: 'session',
    decided_by: 'user',
    decided_at: '2026-07-05T00:00:00.000Z',
    ...overrides,
  };
}

type RequiresApprovalDecision = Extract<PermissionDecision, { type: 'requires_approval' }>;

function requiresApprovalDecision(overrides: Partial<RequiresApprovalDecision> = {}): PermissionDecision {
  return {
    type: 'requires_approval',
    reason: 'Process execution requires approval.',
    execution_class: 'process_execution',
    approval: {
      allowed_scopes: ['once', 'session'],
      default_scope: 'once',
    },
    ...overrides,
  };
}
