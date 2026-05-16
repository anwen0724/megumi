import { describe, expect, it } from 'vitest';

import {
  AgentCancelRequestSchema,
  AgentCheckpointSchema,
  AgentRecoverableRunSummarySchema,
  AgentResumeRequestSchema,
  AgentRetryRequestSchema,
  CHECKPOINT_BOUNDARIES,
  CHECKPOINT_REASONS,
  CHECKPOINT_STATUSES,
} from '@megumi/shared/agent-recovery-contracts';

describe('agent recovery contracts', () => {
  it('parses a checkpoint record with side-effect refs', () => {
    const checkpoint = AgentCheckpointSchema.parse({
      checkpointId: 'checkpoint_123',
      runId: 'run_123',
      stepId: 'step_123',
      actionId: 'action_123',
      reason: 'before_approval_wait',
      status: 'created',
      boundary: 'approval_boundary',
      sequence: 3,
      schemaVersion: 1,
      createdAt: '2026-05-16T10:00:00.000Z',
      createdBy: 'runtime',
      modeSnapshotRef: 'mode_snapshot_123',
      contextBuildRef: 'context_build_123',
      policySnapshotRef: 'policy_snapshot_123',
      toolRegistrySnapshotRef: 'tool_registry_123',
      approvalRequestId: 'approval_request_123',
      toolCallId: 'tool_call_123',
      parentCheckpointId: 'checkpoint_122',
      sideEffectRefs: [
        {
          refId: 'side_effect_123',
          kind: 'tool_call',
          summary: 'workspace_read_file requested approval',
          reversible: false,
          metadata: { toolCallId: 'tool_call_123' },
        },
      ],
      resumeCursor: 'cursor:step_123',
      stateSummary: 'Waiting for approval before tool call.',
      stateRef: 'state_ref_123',
      metadata: { approvalStatus: 'pending' },
    });

    expect(checkpoint.reason).toBe('before_approval_wait');
    expect(checkpoint.sideEffectRefs[0]?.reversible).toBe(false);
  });

  it('rejects invalid checkpoint enum values', () => {
    expect(() =>
      AgentCheckpointSchema.parse({
        checkpointId: 'checkpoint_123',
        runId: 'run_123',
        reason: 'file_snapshot_created',
        status: 'created',
        boundary: 'step_boundary',
        sequence: 1,
        schemaVersion: 1,
        createdAt: '2026-05-16T10:00:00.000Z',
        createdBy: 'runtime',
        sideEffectRefs: [],
        stateSummary: 'Invalid reason.',
      }),
    ).toThrow();
  });

  it('parses resume, cancel, and retry requests', () => {
    expect(
      AgentResumeRequestSchema.parse({
        resumeRequestId: 'resume_request_123',
        runId: 'run_123',
        checkpointId: 'checkpoint_123',
        requestedBy: 'user',
        reason: 'user_requested',
        resumeMode: 'from_checkpoint',
        createdAt: '2026-05-16T10:00:00.000Z',
        metadata: { entry: 'run_detail' },
      }).resumeMode,
    ).toBe('from_checkpoint');

    expect(
      AgentCancelRequestSchema.parse({
        cancelRequestId: 'cancel_request_123',
        runId: 'run_123',
        requestedBy: 'user',
        reason: 'user_requested',
        scope: 'run',
        createdAt: '2026-05-16T10:00:01.000Z',
      }).scope,
    ).toBe('run');

    expect(
      AgentRetryRequestSchema.parse({
        retryRequestId: 'retry_request_123',
        runId: 'run_123',
        stepId: 'step_123',
        actionId: 'action_123',
        checkpointId: 'checkpoint_123',
        requestedBy: 'user',
        retryKind: 'action',
        reason: 'runtime_retryable_error',
        createdAt: '2026-05-16T10:00:02.000Z',
      }).retryKind,
    ).toBe('action');
  });

  it('parses recoverable run summary without changing RuntimeError model', () => {
    const summary = AgentRecoverableRunSummarySchema.parse({
      runId: 'run_123',
      sessionId: 'session_123',
      status: 'waiting_for_approval',
      reason: 'waiting_for_approval',
      latestCheckpointId: 'checkpoint_123',
      latestCheckpointAt: '2026-05-16T10:00:00.000Z',
      title: 'Review file change',
      preview: 'Waiting for approval.',
      metadata: { route: 'workspace' },
    });

    expect(summary.status).toBe('waiting_for_approval');
    expect(JSON.stringify(summary)).not.toContain('recoverable":');
  });

  it('exports stable enum values', () => {
    expect(CHECKPOINT_REASONS).toContain('before_approval_wait');
    expect(CHECKPOINT_STATUSES).toContain('restored');
    expect(CHECKPOINT_BOUNDARIES).toContain('tool_boundary');
  });
});
