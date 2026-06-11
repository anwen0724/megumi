import { z } from 'zod';

import { RunStatusSchema } from '../session/run-contracts';
import { JsonObjectSchema } from '../primitives/json';
import { RuntimeErrorSchema } from '../runtime/errors';
import { IsoDateTimeSchema } from '../runtime/validation';
import { WorkspaceChangeSummarySchema } from '../workspace/change-contracts';

export const CHECKPOINT_REASONS = [
  'run_started',
  'context_built',
  'step_started',
  'step_completed',
  'before_approval_wait',
  'after_approval_decision',
  'before_side_effect',
  'after_observation',
  'before_pause',
  'after_cancel',
  'error_boundary',
  'manual',
  'crash_recovery_marker',
] as const;

export const CHECKPOINT_STATUSES = [
  'created',
  'restored',
  'superseded',
  'invalidated',
  'discarded',
] as const;

export const CHECKPOINT_BOUNDARIES = [
  'run_boundary',
  'step_boundary',
  'approval_boundary',
  'tool_boundary',
  'context_boundary',
  'error_boundary',
  'cancel_boundary',
] as const;

export const CHECKPOINT_CREATED_BY = ['runtime', 'host', 'system', 'user'] as const;

export const RESUME_REQUESTED_BY = ['user', 'host', 'system', 'approval_flow', 'retry_flow', 'crash_recovery'] as const;
export const RESUME_REASONS = [
  'continue_session',
  'approval_resolved',
  'retry_requested',
  'app_restarted',
  'manual_resume',
  'recover_from_error',
  'recover_after_cancel',
] as const;
export const RESUME_MODES = ['same_run', 'rehydrate_runtime', 'from_checkpoint', 'from_latest_recoverable'] as const;

export const CANCEL_REQUESTED_BY = ['user', 'host', 'runtime'] as const;
export const CANCEL_REASONS = [
  'user_requested',
  'superseded_by_new_input',
  'permission_changed',
  'host_shutdown',
  'timeout',
  'policy_denied',
  'runtime_error',
] as const;
export const CANCEL_SCOPES = ['run', 'step', 'action', 'background_process'] as const;

export const RETRY_REQUESTED_BY = ['user', 'host', 'runtime'] as const;
export const RETRY_KINDS = [
  'retry_action',
  'retry_step',
  'retry_run_from_checkpoint',
  'automatic_model_step',
  'manual_retry',
  'manual_rerun',
] as const;
export const RETRY_REASONS = [
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
] as const;

export const CHECKPOINT_RESTORE_STATUSES = ['restored', 'failed'] as const;
export const RECOVERABLE_RUN_REASONS = [
  'waiting_for_approval',
  'paused',
  'failed',
  'cancelled',
  'interrupted',
  'cancelling',
] as const;

export const CheckpointReasonSchema = z.enum(CHECKPOINT_REASONS);
export const CheckpointStatusSchema = z.enum(CHECKPOINT_STATUSES);
export const CheckpointBoundarySchema = z.enum(CHECKPOINT_BOUNDARIES);
export const CheckpointCreatedBySchema = z.enum(CHECKPOINT_CREATED_BY);
export const ResumeRequestedBySchema = z.enum(RESUME_REQUESTED_BY);
export const ResumeReasonSchema = z.enum(RESUME_REASONS);
export const ResumeModeSchema = z.enum(RESUME_MODES);
export const CancelRequestedBySchema = z.enum(CANCEL_REQUESTED_BY);
export const CancelReasonSchema = z.enum(CANCEL_REASONS);
export const CancelScopeSchema = z.enum(CANCEL_SCOPES);
export const RetryRequestedBySchema = z.enum(RETRY_REQUESTED_BY);
export const RetryKindSchema = z.enum(RETRY_KINDS);
export const RetryReasonSchema = z.enum(RETRY_REASONS);
export const CheckpointRestoreStatusSchema = z.enum(CHECKPOINT_RESTORE_STATUSES);
export const RecoverableRunReasonSchema = z.enum(RECOVERABLE_RUN_REASONS);

export const SideEffectRefSchema = z.object({
  refId: z.string().min(1),
  kind: z.string().min(1),
  summary: z.string().min(1),
  reversible: z.boolean(),
  metadata: JsonObjectSchema.optional(),
}).strict();

export type SideEffectRef = z.infer<typeof SideEffectRefSchema>;

export const CheckpointSchema = z.object({
  checkpointId: z.string().min(1),
  runId: z.string().min(1),
  stepId: z.string().min(1).optional(),
  actionId: z.string().min(1).optional(),
  reason: CheckpointReasonSchema,
  status: CheckpointStatusSchema,
  boundary: CheckpointBoundarySchema,
  sequence: z.number().int().nonnegative(),
  schemaVersion: z.number().int().positive(),
  createdAt: IsoDateTimeSchema,
  createdBy: CheckpointCreatedBySchema,
  permissionSnapshotRef: z.string().min(1).optional(),
  contextBuildRef: z.string().min(1).optional(),
  policySnapshotRef: z.string().min(1).optional(),
  toolRegistrySnapshotRef: z.string().min(1).optional(),
  approvalRequestId: z.string().min(1).optional(),
  toolCallId: z.string().min(1).optional(),
  parentCheckpointId: z.string().min(1).optional(),
  sideEffectRefs: z.array(SideEffectRefSchema).default([]),
  resumeCursor: z.string().min(1).optional(),
  stateSummary: z.string().min(1),
  stateRef: z.string().min(1).optional(),
  metadata: JsonObjectSchema.optional(),
}).strict();

export type Checkpoint = z.infer<typeof CheckpointSchema>;

export const ResumeRequestSchema = z.object({
  resumeRequestId: z.string().min(1),
  runId: z.string().min(1),
  checkpointId: z.string().min(1).optional(),
  requestedBy: ResumeRequestedBySchema,
  reason: ResumeReasonSchema,
  resumeMode: ResumeModeSchema,
  createdAt: IsoDateTimeSchema,
  metadata: JsonObjectSchema.optional(),
}).strict();

export type ResumeRequest = z.infer<typeof ResumeRequestSchema>;

export const CancelRequestSchema = z.object({
  cancelRequestId: z.string().min(1),
  runId: z.string().min(1),
  stepId: z.string().min(1).optional(),
  actionId: z.string().min(1).optional(),
  requestedBy: CancelRequestedBySchema,
  reason: CancelReasonSchema,
  scope: CancelScopeSchema,
  createdAt: IsoDateTimeSchema,
  metadata: JsonObjectSchema.optional(),
}).strict();

export type CancelRequest = z.infer<typeof CancelRequestSchema>;

export const RetryRequestSchema = z.object({
  retryRequestId: z.string().min(1),
  runId: z.string().min(1),
  stepId: z.string().min(1).optional(),
  actionId: z.string().min(1).optional(),
  checkpointId: z.string().min(1).optional(),
  requestedBy: RetryRequestedBySchema,
  retryKind: RetryKindSchema,
  reason: RetryReasonSchema,
  createdAt: IsoDateTimeSchema,
  metadata: JsonObjectSchema.optional(),
}).strict();

export type RetryRequest = z.infer<typeof RetryRequestSchema>;

export const CheckpointRestoreRecordSchema = z.object({
  restoreRecordId: z.string().min(1),
  runId: z.string().min(1),
  checkpointId: z.string().min(1),
  resumeRequestId: z.string().min(1).optional(),
  status: CheckpointRestoreStatusSchema,
  restoredAt: IsoDateTimeSchema,
  error: RuntimeErrorSchema.optional(),
  metadata: JsonObjectSchema.optional(),
}).strict();

export type CheckpointRestoreRecord = z.infer<typeof CheckpointRestoreRecordSchema>;

export const RecoverableRunSummarySchema = z.object({
  runId: z.string().min(1),
  sessionId: z.string().min(1),
  status: RunStatusSchema,
  reason: RecoverableRunReasonSchema,
  latestCheckpointId: z.string().min(1).optional(),
  latestCheckpointAt: IsoDateTimeSchema.optional(),
  title: z.string().min(1).optional(),
  preview: z.string().min(1).optional(),
  workspaceChangeSummaries: z.array(WorkspaceChangeSummarySchema).optional(),
  metadata: JsonObjectSchema.optional(),
}).strict();

export type RecoverableRunSummary = z.infer<typeof RecoverableRunSummarySchema>;

export type CheckpointReason = z.infer<typeof CheckpointReasonSchema>;
export type CheckpointStatus = z.infer<typeof CheckpointStatusSchema>;
export type CheckpointBoundary = z.infer<typeof CheckpointBoundarySchema>;
export type ResumeRequestedBy = z.infer<typeof ResumeRequestedBySchema>;
export type ResumeReason = z.infer<typeof ResumeReasonSchema>;
export type ResumeMode = z.infer<typeof ResumeModeSchema>;
export type CancelRequestedBy = z.infer<typeof CancelRequestedBySchema>;
export type CancelReason = z.infer<typeof CancelReasonSchema>;
export type CancelScope = z.infer<typeof CancelScopeSchema>;
export type RetryRequestedBy = z.infer<typeof RetryRequestedBySchema>;
export type RetryKind = z.infer<typeof RetryKindSchema>;
export type RetryReason = z.infer<typeof RetryReasonSchema>;
export type RecoverableRunReason = z.infer<typeof RecoverableRunReasonSchema>;

