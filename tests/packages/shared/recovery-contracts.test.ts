import { describe, expect, it } from 'vitest';

import {
  CancelRequestSchema,
  CheckpointSchema,
  RecoverableRunSummarySchema,
  ResumeRequestSchema,
  RetryRequestSchema,
  CHECKPOINT_BOUNDARIES,
  CHECKPOINT_REASONS,
  CHECKPOINT_STATUSES,
  CANCEL_REASONS,
  CANCEL_REQUESTED_BY,
  CANCEL_SCOPES,
  RESUME_MODES,
  RESUME_REASONS,
  RESUME_REQUESTED_BY,
  RETRY_KINDS,
  RETRY_REASONS,
  RETRY_REQUESTED_BY,
} from '@megumi/shared/recovery-contracts';

describe('recovery contracts', () => {
  it('parses a checkpoint record with side-effect refs', () => {
    const checkpoint = CheckpointSchema.parse({
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
      permissionSnapshotRef: 'permission-snapshot:1',
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
    expect(checkpoint.permissionSnapshotRef).toBe('permission-snapshot:1');
    expect(checkpoint.sideEffectRefs[0]?.reversible).toBe(false);
  });

  it('rejects invalid checkpoint enum values', () => {
    expect(() =>
      CheckpointSchema.parse({
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
      ResumeRequestSchema.parse({
        resumeRequestId: 'resume_request_123',
        runId: 'run_123',
        checkpointId: 'checkpoint_123',
        requestedBy: 'user',
        reason: 'manual_resume',
        resumeMode: 'from_checkpoint',
        createdAt: '2026-05-16T10:00:00.000Z',
        metadata: { entry: 'run_detail' },
      }).resumeMode,
    ).toBe('from_checkpoint');

    expect(
      CancelRequestSchema.parse({
        cancelRequestId: 'cancel_request_123',
        runId: 'run_123',
        requestedBy: 'user',
        reason: 'user_requested',
        scope: 'run',
        createdAt: '2026-05-16T10:00:01.000Z',
      }).scope,
    ).toBe('run');

    expect(
      RetryRequestSchema.parse({
        retryRequestId: 'retry_request_123',
        runId: 'run_123',
        stepId: 'step_123',
        actionId: 'action_123',
        checkpointId: 'checkpoint_123',
        requestedBy: 'runtime',
        retryKind: 'retry_action',
        reason: 'runtime_error',
        createdAt: '2026-05-16T10:00:02.000Z',
      }).retryKind,
    ).toBe('retry_action');
  });

  it('accepts 10.01 retry request kinds while keeping legacy recovery kinds', () => {
    expect(RETRY_KINDS).toEqual(expect.arrayContaining([
      'retry_action',
      'retry_step',
      'retry_run_from_checkpoint',
      'automatic_model_step',
      'manual_retry',
      'manual_rerun',
    ]));
    expect(RETRY_REASONS).toEqual(expect.arrayContaining([
      'provider_overload',
      'rate_limited',
      'service_unavailable',
      'network_timeout',
      'premature_stream_end',
      'runtime_provider_error',
      'interrupted',
    ]));

    expect(RetryRequestSchema.parse({
      retryRequestId: 'retry_request_auto',
      runId: 'run_123',
      requestedBy: 'runtime',
      retryKind: 'automatic_model_step',
      reason: 'rate_limited',
      createdAt: '2026-06-01T10:00:00.000Z',
    }).retryKind).toBe('automatic_model_step');

    expect(RetryRequestSchema.parse({
      retryRequestId: 'retry_request_manual',
      runId: 'run_123',
      requestedBy: 'user',
      retryKind: 'manual_rerun',
      reason: 'interrupted',
      createdAt: '2026-06-01T10:00:01.000Z',
    }).reason).toBe('interrupted');
  });

  it('rejects extra fields in recovery request records', () => {
    expect(ResumeRequestSchema.safeParse({
      resumeRequestId: 'resume_request_123',
      runId: 'run_123',
      requestedBy: 'user',
      reason: 'manual_resume',
      resumeMode: 'from_checkpoint',
      createdAt: '2026-05-16T10:00:00.000Z',
      rawStack: 'secret stack',
    }).success).toBe(false);

    expect(CancelRequestSchema.safeParse({
      cancelRequestId: 'cancel_request_123',
      runId: 'run_123',
      requestedBy: 'runtime',
      reason: 'runtime_error',
      scope: 'run',
      createdAt: '2026-05-16T10:00:01.000Z',
      rawCause: 'secret cause',
    }).success).toBe(false);

    expect(RetryRequestSchema.safeParse({
      retryRequestId: 'retry_request_123',
      runId: 'run_123',
      requestedBy: 'runtime',
      retryKind: 'retry_step',
      reason: 'failed',
      createdAt: '2026-05-16T10:00:02.000Z',
      rawProviderBody: 'secret body',
    }).success).toBe(false);
  });

  it('parses recoverable run summary without changing RuntimeError model', () => {
    const summary = RecoverableRunSummarySchema.parse({
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
    expect(RESUME_REQUESTED_BY).toEqual(['user', 'host', 'system', 'approval_flow', 'retry_flow', 'crash_recovery']);
    expect(RESUME_REASONS).toEqual([
      'continue_session',
      'approval_resolved',
      'retry_requested',
      'app_restarted',
      'manual_resume',
      'recover_from_error',
      'recover_after_cancel',
    ]);
    expect(RESUME_MODES).toEqual(['same_run', 'rehydrate_runtime', 'from_checkpoint', 'from_latest_recoverable']);
    expect(CANCEL_REQUESTED_BY).toEqual(['user', 'host', 'runtime']);
    expect(CANCEL_REASONS).toEqual([
      'user_requested',
      'superseded_by_new_input',
      'permission_changed',
      'host_shutdown',
      'timeout',
      'policy_denied',
      'runtime_error',
    ]);
    expect(CANCEL_SCOPES).toEqual(['run', 'step', 'action', 'background_process']);
    expect(RETRY_REQUESTED_BY).toEqual(['user', 'host', 'runtime']);
    expect(RETRY_KINDS).toEqual([
      'retry_action',
      'retry_step',
      'retry_run_from_checkpoint',
      'automatic_model_step',
      'manual_retry',
      'manual_rerun',
    ]);
    expect(RETRY_REASONS).toEqual([
      'user_requested',
      'failed',
      'cancelled',
      'approval_resolved',
      'runtime_error',
      'provider_overload',
      'rate_limited',
      'service_unavailable',
      'network_timeout',
      'premature_stream_end',
      'runtime_provider_error',
      'interrupted',
    ]);
  });
});
