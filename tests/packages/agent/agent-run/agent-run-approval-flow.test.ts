// @vitest-environment node
/* Verifies atomic approval application and Agent Run continuation decisions. */
import { describe, expect, it, vi } from 'vitest';
import { createApprovalWait, resumeApprovalFlow } from '@megumi/agent/agent-run/core/approval-flow';
import type { AgentRun, AgentRunApprovalRequest } from '@megumi/agent/agent-run';
import type { PermissionDecision, PermissionOperation } from '@megumi/agent/permissions';

const operation: PermissionOperation = {
  action: 'process.execute',
  resource: { type: 'process.command', id: 'npm test' },
  context: {
    workspace_id: 'workspace_1', session_id: 'session_1', run_id: 'run_1',
    tool_identity: { registered_tool_name: 'run_command', source_id: 'built_in', namespace: 'megumi', source_tool_name: 'run_command' },
  },
};
const decision: Extract<PermissionDecision, { type: 'requires_approval' }> = {
  type: 'requires_approval', operations: [operation], safety_assessment: 'safe', reason: 'Ask mode.',
  default_option_id: 'once:call_1',
  options: [{
    option_id: 'once:call_1', scope: 'once',
    display: { label: 'Once', description: 'This call only.' },
    effect: { type: 'current_tool_call' },
  }],
};
const run = (status: AgentRun['status'] = 'waiting_for_approval'): AgentRun => ({
  run_id: 'run_1', workspace_id: 'workspace_1', session_id: 'session_1', model_selection: { provider_id: 'p', model_id: 'm' },
  trigger: { type: 'user_input', user_message_id: 'user_1' }, status, created_at: '2026-07-19T00:00:00.000Z',
});
const approval = (): AgentRunApprovalRequest => ({
  approval_request_id: 'approval_1', run_id: 'run_1',
  subject: { type: 'tool_call', tool_call_id: 'call_1', tool_name: 'run_command', input: { command: 'npm test' } },
  status: 'pending', options: decision.options, default_option_id: decision.default_option_id,
  created_at: '2026-07-19T00:00:00.000Z',
});

describe('approval flow', () => {
  it('creates a wait record with immutable options', () => {
    const repository = { saveRun: vi.fn((value) => value), createApprovalRequest: vi.fn((value) => value) };
    const result = createApprovalWait({
      run: run('running'), approval_request_id: 'approval_1', subject: approval().subject,
      options: decision.options, default_option_id: decision.default_option_id,
      repository, changed_at: '2026-07-19T00:00:01.000Z',
    });
    expect(result.run.status).toBe('waiting_for_approval');
    expect(result.approval_request).toMatchObject({ options: decision.options, default_option_id: 'once:call_1' });
  });

  it('applies an approved option once and resumes the run', async () => {
    const applyApprovalDecision = vi.fn(async () => ({ status: 'applied' as const, effect: { type: 'none' as const } }));
    const result = await resumeApprovalFlow({
      run: run(), approval_request: approval(), pending_approval_requests_after_decision: [approval()],
      original_permission_decision: decision, session_id: 'session_1', permission_service: { applyApprovalDecision },
      decision: { approval_request_id: 'approval_1', decision: 'approved', option_id: 'once:call_1', decided_by: 'user', decided_at: '2026-07-19T00:00:02.000Z' },
      decided_at: '2026-07-19T00:00:02.000Z',
    });
    expect(applyApprovalDecision).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'approved', run: { status: 'running' }, continuation: 'continue_tool_group' });
  });

  it('keeps a rejected application pending and returns a retryable flow failure', async () => {
    const result = await resumeApprovalFlow({
      run: run(), approval_request: approval(), pending_approval_requests_after_decision: [approval()],
      original_permission_decision: decision, session_id: 'session_1',
      permission_service: { applyApprovalDecision: vi.fn(async () => ({ status: 'rejected' as const, reason: 'option_not_found' as const, message: 'Unknown option.' })) },
      decision: { approval_request_id: 'approval_1', decision: 'approved', option_id: 'forged', decided_by: 'user', decided_at: '2026-07-19T00:00:02.000Z' },
      decided_at: '2026-07-19T00:00:02.000Z',
    });
    expect(result).toMatchObject({ status: 'failed', failure: { code: 'approval_failed', message: 'Unknown option.' } });
  });

  it('creates a canonical user_rejected tool result for denial', async () => {
    const result = await resumeApprovalFlow({
      run: run(), approval_request: approval(), pending_approval_requests_after_decision: [approval()],
      original_permission_decision: decision, session_id: 'session_1',
      permission_service: { applyApprovalDecision: vi.fn(async () => ({ status: 'applied' as const, effect: { type: 'none' as const } })) },
      decision: { approval_request_id: 'approval_1', decision: 'denied', decided_by: 'user', decided_at: '2026-07-19T00:00:02.000Z' },
      decided_at: '2026-07-19T00:00:02.000Z',
    });
    expect(result).toMatchObject({ status: 'denied', tool_result: { status: 'user_rejected', error: { code: 'user_rejected' } } });
  });
});
