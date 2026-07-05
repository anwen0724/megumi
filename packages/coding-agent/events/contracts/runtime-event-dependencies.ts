/*
 * Local dependency contracts for runtime events while legacy event payloads are
 * still broader than the refactored module contracts.
 */
import { z } from 'zod';
import { JsonObjectSchema, JsonValueSchema, type JsonObject } from '../../shared-json';

export type ModelInputContextSourceRef = {
  sourceRefId?: string;
  sourceId?: string;
  sourceKind?: string;
  label?: string;
  metadata?: JsonObject;
};

export const ModelInputContextSourceRefSchema = z
  .object({
    sourceRefId: z.string().min(1).optional(),
    sourceId: z.string().min(1).optional(),
    sourceKind: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .passthrough();

export const SESSION_ACTIVE_LEAF_REASONS = ['user_selected', 'branch_created', 'run_completed', 'system'] as const;
export const SESSION_BRANCH_MARKER_REASONS = ['branch', 'rerun', 'system'] as const;
export const SESSION_INTERRUPTED_RUN_PREVIOUS_STATUSES = ['running', 'waiting_for_approval'] as const;
export const SESSION_INTERRUPTED_RUN_REASONS = ['approval_required', 'cancelled', 'failed', 'runtime_restarted'] as const;
export const SESSION_COMPACTION_TRIGGER_REASONS = ['manual', 'automatic', 'context_limit'] as const;

export type SessionActiveLeafReason = string;
export type SessionBranchMarkerReason = string;
export type SessionInterruptedRunPreviousStatus = string;
export type SessionInterruptedRunReason = string;
export type SessionCompactionTriggerReason = string;
export type RunActionKind = string;
export type RunActionStatus = string;
export type RunObservationSource = string;
export type RunStatus = string;
export type SessionMessageStatus = string;
export type SessionStatus = string;
export type RunStepKind = string;
export type RunStepStatus = string;

export const RunActionKindSchema = z.string().min(1);
export const RunActionStatusSchema = z.string().min(1);
export const RunObservationSourceSchema = z.string().min(1);
export const RunStatusSchema = z.string().min(1);
export const RunStepKindSchema = z.string().min(1);
export const RunStepStatusSchema = z.string().min(1);
export const SessionMessageStatusSchema = z.string().min(1);
export const SessionStatusSchema = z.string().min(1);

export const CONTEXT_PATCH_OPERATIONS = ['add', 'replace', 'remove'] as const;
export const CONTEXT_PATCH_REQUESTERS = ['system', 'agent', 'host'] as const;

export type ContextPatchRequestedPayload = Record<string, unknown>;
export type ContextPatchAppliedPayload = Record<string, unknown>;
export type ContextPatchRejectedPayload = Record<string, unknown>;
export type ContextEffectiveUpdatedPayload = Record<string, unknown>;

export type ToolName = string;
export type ApprovalScope = string;
export type ApprovalStatus = string;
export type ApprovalRequest = Record<string, unknown>;
export type PermissionDecision = Record<string, unknown>;
export type ToolPolicyDecision = Record<string, unknown>;
export type ToolExecution = Record<string, unknown>;

export const APPROVAL_SCOPES = ['once', 'session'] as const;
export const ToolNameSchema = z.string().min(1);
export const ApprovalRequestSchema = JsonObjectSchema;
export const PermissionDecisionSchema = JsonObjectSchema;
export const ToolPolicyDecisionSchema = JsonObjectSchema;
export const ToolExecutionSchema = JsonObjectSchema;

export type CancelReason = string;
export type CancelRequestedBy = string;
export type CancelScope = string;
export type CheckpointBoundary = string;
export type CheckpointReason = string;
export type ResumeMode = string;
export type ResumeReason = string;
export type ResumeRequestedBy = string;
export type RetryKind = string;
export type RetryReason = string;
export type RetryRequestedBy = string;

export const CancelReasonSchema = z.string().min(1);
export const CancelRequestedBySchema = z.string().min(1);
export const CancelScopeSchema = z.string().min(1);
export const CheckpointBoundarySchema = z.string().min(1);
export const CheckpointReasonSchema = z.string().min(1);
export const ResumeModeSchema = z.string().min(1);
export const ResumeReasonSchema = z.string().min(1);
export const ResumeRequestedBySchema = z.string().min(1);
export const RetryKindSchema = z.string().min(1);
export const RetryReasonSchema = z.string().min(1);
export const RetryRequestedBySchema = z.string().min(1);

export type WorkspaceRestoreRequestedBy = string;
export type WorkspaceRestoreResultStatus = string;
export const WorkspaceRestoreRequestedBySchema = z.string().min(1);
export const WorkspaceRestoreResultStatusSchema = z.string().min(1);

export type ArtifactContentStorage = string;
export type ArtifactContentType = string;
export type ArtifactKind = string;
export type ArtifactStatus = string;
export const ArtifactContentStorageSchema = z.string().min(1);
export const ArtifactContentTypeSchema = z.string().min(1);
export const ArtifactKindSchema = z.string().min(1);
export const ArtifactStatusSchema = z.string().min(1);

export type MemoryAccessKind = string;
export type MemoryCandidateStatus = string;
export type MemoryKind = string;
export type MemoryRecordStatus = string;
export type MemoryRiskLevel = string;
export type MemoryScope = string;
export const MemoryAccessKindSchema = z.string().min(1);
export const MemoryCandidateStatusSchema = z.string().min(1);
export const MemoryKindSchema = z.string().min(1);
export const MemoryRecordStatusSchema = z.string().min(1);
export const MemoryRiskLevelSchema = z.string().min(1);
export const MemoryScopeSchema = z.string().min(1);

export type ModelStepProviderState = {
  providerStateId?: string;
  providerId?: string;
  modelId?: string;
  stateKind?: string;
  value?: unknown;
  metadata?: JsonObject;
};

export const ModelStepProviderStateSchema = z
  .object({
    providerStateId: z.string().min(1).optional(),
    providerId: z.string().min(1).optional(),
    modelId: z.string().min(1).optional(),
    stateKind: z.string().min(1).optional(),
    value: JsonValueSchema.optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .passthrough();
