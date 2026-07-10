/*
 * Verifies ApprovalHost result mapping.
 */
import { describe, expect, it, vi } from 'vitest';
import { createApprovalHost } from '@megumi/product/host-interface/approval-host';

describe('createApprovalHost', () => {
  it('returns failed when Agent Run cannot resume the approval', async () => {
    const controller = createApprovalHost({
      resumeRunAfterApproval: vi.fn(async () => ({
        status: 'failed' as const,
        failure: {
          code: 'runtime_interrupted' as const,
          message: 'Approval continuation is no longer available in this runtime.',
          retryable: false,
        },
        events: [],
      })),
    });

    const result = await controller.resolve({
      approvalRequestId: 'approval-1',
      decision: 'approved',
      scope: 'once',
      decidedAt: '2026-07-09T00:00:00.000Z',
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
  });

  it('returns resolved and forwards Agent Run events when approval resumes', async () => {
    async function* events() {}
    const controller = createApprovalHost({
      resumeRunAfterApproval: vi.fn(async () => ({
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
      })),
    });

    const result = await controller.resolve({
      approvalRequestId: 'approval-1',
      decision: 'approved',
      scope: 'session',
      decidedAt: '2026-07-09T00:00:00.000Z',
    });

    expect(result.payload.status).toBe('resolved');
    if (result.payload.status !== 'resolved') {
      throw new Error('Expected approval to resolve.');
    }
    expect(result.payload.data.approval).toMatchObject({
      approvalRequestId: 'approval-1',
      decision: 'approved',
      scope: 'session',
      decidedBy: 'user',
    });
    expect(result.events).toBeDefined();
  });
});
