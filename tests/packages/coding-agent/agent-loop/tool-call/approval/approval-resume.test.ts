import { describe, expect, it } from 'vitest';
import { createToolCallRunnerHarness, awaitingApprovalRecord, terminalSucceededRecord } from '../tool-call-runner.test-harness';

describe('approval-resume', () => {
  it('resumes a pending approval through the tool-call runner contract', async () => {
    const harness = createToolCallRunnerHarness({
      existingRecords: [
        terminalSucceededRecord('call-read', 0),
        awaitingApprovalRecord('call-edit', 1),
      ],
    });

    const outcome = await harness.toolCallHandler.resumeToolApproval({
      approvalRequestId: 'approval:1',
      decision: 'approved',
      decidedAt: '2026-06-15T00:01:00.000Z',
    });

    expect(outcome?.pendingApprovals).toEqual([]);
    expect(harness.recordsByCallOrder().find((record) => record.toolCallId === 'call-edit')?.status).toBe('succeeded');
  });
});
