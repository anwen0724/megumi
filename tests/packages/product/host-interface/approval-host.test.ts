/*
 * Verifies ApprovalHost result mapping.
 */
import { describe, expect, it, vi } from 'vitest';
import { createApprovalHost } from '@megumi/product/host-interface/approval-host';

describe('createApprovalHost', () => {
  it('returns failed when Agent Run cannot resume the approval', async () => {
    const resumeRunAfterApproval = vi.fn(async () => ({
      status: 'failed' as const,
      failure: {
        code: 'runtime_interrupted' as const,
        message: 'Approval continuation is no longer available in this runtime.',
        retryable: false,
      },
      events: [],
    }));
    const controller = createApprovalHost({
      resumeRunAfterApproval,
    });

    const result = await controller.resolve({
      approvalRequestId: 'approval-1',
      decision: 'approved',
      scope: 'once',
    });

    expect(result).toEqual({
      payload: {
        status: 'failed',
        approvalRequestId: 'approval-1',
        failure: {
          code: 'runtime_interrupted',
          message: 'Approval continuation is no longer available in this runtime.',
          retryable: false,
        },
      },
      events: expect.anything(),
    });
    expect(resumeRunAfterApproval).toHaveBeenCalledWith({
      approval_request_id: 'approval-1',
      decision: {
        approval_request_id: 'approval-1',
        decision: 'approved',
        scope: 'once',
        decided_by: 'user',
      },
    });
  });

  it('returns resolved and forwards Agent Run events when approval resumes', async () => {
    async function* events() {}
    const resumeRunAfterApproval = vi.fn(async () => ({
      status: 'resumed' as const,
      run: {
        run_id: 'run-1',
        workspace_id: 'workspace-1',
        session_id: 'session-1',
        model_selection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
        trigger: { type: 'user_input' as const, user_message_id: 'message-1' },
        status: 'running' as const,
        created_at: '2026-07-09T00:00:00.000Z',
      },
      events: events(),
    }));
    const controller = createApprovalHost({
      resumeRunAfterApproval,
    });

    const result = await controller.resolve({
      approvalRequestId: 'approval-1',
      decision: 'approved',
      scope: 'session',
    });

    expect(result.payload).toEqual({
      status: 'resolved',
      approvalRequestId: 'approval-1',
    });
    expect(result.payload).not.toHaveProperty('data');
    expect(result.events).toBeDefined();
    expect(resumeRunAfterApproval).toHaveBeenCalledWith({
      approval_request_id: 'approval-1',
      decision: {
        approval_request_id: 'approval-1',
        decision: 'approved',
        scope: 'session',
        decided_by: 'user',
      },
    });
  });
});
