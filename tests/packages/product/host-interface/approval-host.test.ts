/*
 * Verifies Product approval resolution and the thin Host forwarding adapter.
 */
import { describe, expect, it, vi } from 'vitest';
import { createProductApproval } from '../../../../packages/product/src/approval';
import { createApprovalHost } from '../../../../packages/product/src/host/approval-host';

describe('ApprovalHost', () => {
  it('maps an approved decision to Engine', async () => {
    const resolveApproval = vi.fn(async () => ({
      status: 'accepted' as const,
      run: runFixture('waiting'),
    }));
    const host = createApprovalHost(createProductApproval({ resolveApproval } as never));

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
    // as 'resumed' with the run facts.
    expect(result.payload).toEqual({
      status: 'resumed',
      approvalRequestId: 'approval:1',
      run: {
        runId: 'run:1',
        sessionId: 'session:1',
        status: 'waiting',
        createdAt: '2026-07-10T00:00:00.000Z',
      },
    });
  });

  it('maps a denied decision without inventing decision metadata', async () => {
    const resolveApproval = vi.fn(async () => ({
      status: 'accepted' as const,
      run: runFixture('waiting'),
    }));
    const host = createApprovalHost(createProductApproval({ resolveApproval } as never));

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
      { status: 'not_waiting' as const, approvalId: 'approval:1', run: runFixture('completed') },
      {
        status: 'not_waiting',
        approvalRequestId: 'approval:1',
        run: expect.objectContaining({ status: 'completed' }),
      },
    ],
    [
      { status: 'already_resolved' as const, approvalId: 'approval:1', run: runFixture('completed') },
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
  ])('projects Engine approval result %s', async (engineResult, expectedPayload) => {
    const host = createApprovalHost(createProductApproval({
      resolveApproval: vi.fn(async () => engineResult),
    } as never));

    const result = await host.resolve({
      approvalRequestId: 'approval:1',
      decision: 'denied',
    });

    expect(result.payload).toEqual(expectedPayload);
  });
});

function runFixture(status: 'waiting' | 'completed') {
  return {
    runId: 'run:1',
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
