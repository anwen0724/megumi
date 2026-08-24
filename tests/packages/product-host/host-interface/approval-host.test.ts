/*
 * Verifies Product approval operations against Agent Execution-owned state.
 */
import { describe, expect, it, vi } from 'vitest';
import { createApprovalOperations } from '../../../../packages/agent/product-host/src/operations/approval-operations';

describe('ApprovalHost', () => {
  it('maps an approved decision to Agent Execution', async () => {
    const resolveApproval = vi.fn(async () => ({
      status: 'accepted' as const,
      execution: executionFixture('waiting'),
    }));
    const host = createApprovalOperations({ resolveApproval } as never);

    const result = await host.resolve({
      approvalRequestId: 'approval:1',
      decision: 'approved',
      optionId: 'allow_once',
      reason: 'Needed for this task.',
    });

    expect(resolveApproval).toHaveBeenCalledWith({
      approvalId: 'approval:1',
      decision: {
        decision: 'approved',
        optionId: 'allow_once',
        reason: 'Needed for this task.',
      },
    });
    // Desktop keeps the previous success behavior: an accepted decision reads
    // as 'resumed' with the execution facts.
    expect(result.payload).toEqual({
      status: 'resumed',
      approvalRequestId: 'approval:1',
      run: {
        executionId: 'execution:1',
        sessionId: 'session:1',
        status: 'waiting',
        createdAt: '2026-07-10T00:00:00.000Z',
      },
    });
  });

  it('maps a denied decision without inventing decision metadata', async () => {
    const resolveApproval = vi.fn(async () => ({
      status: 'accepted' as const,
      execution: executionFixture('waiting'),
    }));
    const host = createApprovalOperations({ resolveApproval } as never);

    await host.resolve({
      approvalRequestId: 'approval:1',
      decision: 'denied',
      reason: 'Not allowed.',
    });

    expect(resolveApproval).toHaveBeenCalledWith({
      approvalId: 'approval:1',
      decision: { decision: 'denied', reason: 'Not allowed.' },
    });
  });

  it.each([
    [
      { status: 'not_found' as const, approvalId: 'approval:missing' },
      { status: 'not_found', approvalRequestId: 'approval:missing' },
    ],
    [
      { status: 'not_waiting' as const, approvalId: 'approval:1', execution: executionFixture('completed') },
      {
        status: 'not_waiting',
        approvalRequestId: 'approval:1',
        run: expect.objectContaining({ status: 'completed' }),
      },
    ],
    [
      { status: 'already_resolved' as const, approvalId: 'approval:1', execution: executionFixture('completed') },
      {
        status: 'not_waiting',
        approvalRequestId: 'approval:1',
        run: expect.objectContaining({ status: 'completed' }),
      },
    ],
    [
      {
        status: 'failed' as const,
        failure: {
          code: 'permission_failed' as const,
          message: 'Permission decision failed.',
          retryable: false,
        },
      },
      {
        status: 'failed',
        approvalRequestId: 'approval:1',
        failure: {
          code: 'permission_failed',
          message: 'Permission decision failed.',
          retryable: false,
        },
      },
    ],
  ])('projects Agent Execution approval result %s', async (agentResult, expectedPayload) => {
    const host = createApprovalOperations({
      resolveApproval: vi.fn(async () => agentResult),
    } as never);

    const result = await host.resolve({
      approvalRequestId: 'approval:1',
      decision: 'denied',
    });

    expect(result.payload).toEqual(expectedPayload);
  });
});

function executionFixture(status: 'waiting' | 'completed') {
  return {
    kind: 'conversation',
    executionId: 'execution:1',
    requestId: 'request:1',
    workspaceId: 'workspace:1',
    sessionId: 'session:1',
    userMessageId: 'message:1',
    model: {},
    permissionMode: 'ask',
    status,
    createdAt: '2026-07-10T00:00:00.000Z',
    startedAt: '2026-07-10T00:00:00.000Z',
    ...(status === 'completed' ? { completedAt: '2026-07-10T00:01:00.000Z' } : {}),
  } as never;
}
