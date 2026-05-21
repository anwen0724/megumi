import { beforeEach, describe, expect, it } from 'vitest';
import { useApprovalStore } from '@megumi/desktop/renderer/entities/approval';
import type { ApprovalRequest } from '@megumi/shared/tool-contracts';

const approval: ApprovalRequest = {
  approvalRequestId: 'approval-1',
  toolUseId: 'tool-use-1',
  toolCallId: 'tool-call-1',
  runId: 'run-1',
  stepId: 'step-1',
  toolName: 'write_file',
  capabilities: ['project_write'],
  riskLevel: 'medium',
  title: 'Approve write',
  summary: 'Write file.',
  preview: { action: 'Write file', targets: [{ kind: 'file', label: 'src/index.ts' }] },
  requestedScope: 'once',
  status: 'pending',
  createdAt: '2026-05-16T00:00:00.000Z',
};

describe('useApprovalStore', () => {
  beforeEach(() => {
    useApprovalStore.getState().reset();
  });

  it('tracks pending approvals and resolved decisions', () => {
    useApprovalStore.getState().upsertApprovalRequest(approval);
    expect(useApprovalStore.getState().pendingApprovals()).toEqual([approval]);

    useApprovalStore.getState().markResolved('approval-1', 'approved', '2026-05-16T00:00:01.000Z');
    expect(useApprovalStore.getState().pendingApprovals()).toEqual([]);
    expect(useApprovalStore.getState().approvalRequestsById['approval-1']).toMatchObject({
      status: 'approved',
      resolvedAt: '2026-05-16T00:00:01.000Z',
    });
  });

  it('lists approvals for a run sorted by creation time', () => {
    const laterApproval: ApprovalRequest = {
      ...approval,
      approvalRequestId: 'approval-2',
      createdAt: '2026-05-16T00:00:02.000Z',
    };
    const earlierApproval: ApprovalRequest = {
      ...approval,
      approvalRequestId: 'approval-3',
      createdAt: '2026-05-16T00:00:01.000Z',
    };
    const otherRunApproval: ApprovalRequest = {
      ...approval,
      approvalRequestId: 'approval-4',
      runId: 'run-2',
      createdAt: '2026-05-16T00:00:00.000Z',
    };

    useApprovalStore.getState().upsertApprovalRequest(laterApproval);
    useApprovalStore.getState().upsertApprovalRequest(otherRunApproval);
    useApprovalStore.getState().upsertApprovalRequest(earlierApproval);

    expect(useApprovalStore.getState().listByRun('run-1').map((item) => item.approvalRequestId)).toEqual([
      'approval-3',
      'approval-2',
    ]);
  });
});
