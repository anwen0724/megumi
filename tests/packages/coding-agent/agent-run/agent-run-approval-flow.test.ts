import { describe, expect, it, vi } from 'vitest';
import type {
  AgentRun,
  AgentRunApprovalRequest,
  ApprovalDecision,
} from '@megumi/coding-agent/agent-run';
import type { PermissionDecision, PermissionService } from '@megumi/coding-agent/permissions';
import {
  createApprovalWait,
  resumeApprovalFlow,
} from '@megumi/coding-agent/agent-run/core/approval-flow';

describe('Agent Run approval flow', () => {
  it('creates a minimal approval request and moves the run to waiting_for_approval', () => {
    const repository = approvalRepository();
    const result = createApprovalWait({
      run: sampleRun({ status: 'running' }),
      approval_request_id: 'approval-1',
      subject: {
        type: 'tool_call',
        tool_call_id: 'tool-call-1',
        tool_name: 'run_command',
        input: { command: 'npm test' },
      },
      repository,
      changed_at: '2026-01-01T00:00:00.000Z',
    });

    expect(result.run.status).toBe('waiting_for_approval');
    expect(repository.getApprovalRequest('approval-1')).toEqual(result.approval_request);
    expect(result.approval_request.subject).toEqual({
      type: 'tool_call',
      tool_call_id: 'tool-call-1',
      tool_name: 'run_command',
      input: { command: 'npm test' },
    });
  });

  it('rejects missing, stale, or non-waiting approval resume requests', async () => {
    const permissionService = permissionServiceStub();
    await expect(resumeApprovalFlow({
      run: sampleRun({ status: 'waiting_for_approval' }),
      approval_request: undefined,
      pending_approval_requests_after_decision: [],
      original_permission_decision: requiresApprovalDecision(),
      decision: approvalDecision(),
      session_id: 'session-1',
      permission_service: permissionService,
      decided_at: '2026-01-01T00:00:00.000Z',
    })).resolves.toEqual({ status: 'not_found', approval_request_id: 'approval-1' });

    await expect(resumeApprovalFlow({
      run: sampleRun({ status: 'running' }),
      approval_request: sampleApprovalRequest(),
      pending_approval_requests_after_decision: [],
      original_permission_decision: requiresApprovalDecision(),
      decision: approvalDecision(),
      session_id: 'session-1',
      permission_service: permissionService,
      decided_at: '2026-01-01T00:00:00.000Z',
    })).resolves.toMatchObject({ status: 'not_waiting' });

    await expect(resumeApprovalFlow({
      run: sampleRun({ status: 'waiting_for_approval' }),
      approval_request: sampleApprovalRequest({ status: 'approved' }),
      pending_approval_requests_after_decision: [],
      original_permission_decision: requiresApprovalDecision(),
      decision: approvalDecision(),
      session_id: 'session-1',
      permission_service: permissionService,
      decided_at: '2026-01-01T00:00:00.000Z',
    })).resolves.toMatchObject({
      status: 'failed',
      failure: { code: 'approval_failed' },
    });
  });

  it('validates and applies approved decisions before continuing the same tool-call group', async () => {
    const permissionService = permissionServiceStub();
    const result = await resumeApprovalFlow({
      run: sampleRun({ status: 'waiting_for_approval' }),
      approval_request: sampleApprovalRequest(),
      pending_approval_requests_after_decision: [],
      original_permission_decision: requiresApprovalDecision(),
      decision: approvalDecision(),
      session_id: 'session-1',
      permission_service: permissionService,
      decided_at: '2026-01-01T00:00:00.000Z',
    });

    expect(permissionService.validateApprovalDecision).toHaveBeenCalledOnce();
    expect(permissionService.applyApprovalDecision).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      status: 'approved',
      run: { status: 'running' },
      approval_request: { status: 'approved' },
      continuation: 'continue_tool_group',
      next_model_prompt_ready: false,
    });
  });

  it('turns denied decisions into rejected tool results and keeps waiting when the group still has approvals', async () => {
    const result = await resumeApprovalFlow({
      run: sampleRun({ status: 'waiting_for_approval' }),
      approval_request: sampleApprovalRequest(),
      pending_approval_requests_after_decision: [
        sampleApprovalRequest({ approval_request_id: 'approval-2' }),
      ],
      original_permission_decision: requiresApprovalDecision(),
      decision: approvalDecision({ decision: 'denied' }),
      session_id: 'session-1',
      permission_service: permissionServiceStub(),
      decided_at: '2026-01-01T00:00:00.000Z',
    });

    expect(result).toMatchObject({
      status: 'denied',
      run: { status: 'waiting_for_approval' },
      approval_request: { status: 'denied' },
      continuation: 'waiting_for_other_approval',
      next_model_prompt_ready: false,
      tool_result: {
        tool_call_id: 'tool-call-1',
        tool_name: 'run_command',
        status: 'denied',
      },
    });
  });
});

function approvalRepository() {
  const runs = new Map<string, AgentRun>();
  const approvals = new Map<string, AgentRunApprovalRequest>();
  return {
    saveRun: (run: AgentRun) => {
      runs.set(run.run_id, run);
      return run;
    },
    createApprovalRequest: (approval: AgentRunApprovalRequest) => {
      approvals.set(approval.approval_request_id, approval);
      return approval;
    },
    getApprovalRequest: (approvalRequestId: string) => approvals.get(approvalRequestId),
  };
}

function permissionServiceStub(): Pick<PermissionService, 'validateApprovalDecision' | 'applyApprovalDecision'> {
  const validateApprovalDecision: PermissionService['validateApprovalDecision'] = vi.fn(() => ({ status: 'accepted' as const }));
  const applyApprovalDecision: PermissionService['applyApprovalDecision'] = vi.fn(async () => ({
    status: 'applied' as const,
    permission_state_change: { type: 'none' as const },
  }));

  return {
    validateApprovalDecision,
    applyApprovalDecision,
  };
}

function sampleRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    run_id: 'run-1',
    workspace_id: 'workspace-1',
    session_id: 'session-1',
    model_selection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
    trigger: { type: 'user_input', user_message_id: 'message-1' },
    status: 'running',
    created_at: '2026-01-01T00:00:00.000Z',
    started_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function sampleApprovalRequest(
  overrides: Partial<AgentRunApprovalRequest> = {},
): AgentRunApprovalRequest {
  return {
    approval_request_id: 'approval-1',
    run_id: 'run-1',
    subject: {
      type: 'tool_call',
      tool_call_id: 'tool-call-1',
      tool_name: 'run_command',
      input: { command: 'npm test' },
    },
    status: 'pending',
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function requiresApprovalDecision(): PermissionDecision {
  return {
    type: 'requires_approval',
    reason: 'needs approval',
    execution_class: 'process_execution',
    approval: {
      allowed_scopes: ['once', 'session'],
      default_scope: 'once',
    },
  };
}

function approvalDecision(overrides: Partial<ApprovalDecision> = {}): ApprovalDecision {
  return {
    approval_request_id: 'approval-1',
    decision: 'approved',
    scope: 'once',
    decided_by: 'user',
    decided_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}
