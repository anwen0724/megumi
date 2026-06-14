import { z } from 'zod';
import { JsonObjectSchema, JsonValueSchema } from '../primitives/json';
import { RuntimeContextSchema } from '../runtime/context';
import { RuntimeErrorSchema } from '../runtime/errors';
import { ModelInputContextSourceRefSchema } from '../model/input-context-contracts';
import {
  SESSION_ACTIVE_LEAF_REASONS,
  SESSION_BRANCH_MARKER_REASONS,
  SESSION_INTERRUPTED_RUN_PREVIOUS_STATUSES,
  SESSION_INTERRUPTED_RUN_REASONS,
} from '../session/active-path-contracts';
import { SESSION_COMPACTION_TRIGGER_REASONS } from '../session/compaction-contracts';
import {
  RunActionKindSchema,
  RunActionStatusSchema,
  RunObservationSourceSchema,
  RunStatusSchema,
  RunStepKindSchema,
  RunStepStatusSchema,
  SessionMessageStatusSchema,
  SessionStatusSchema,
} from '../session/run-contracts';
import {
  CONTEXT_PATCH_OPERATIONS,
  CONTEXT_PATCH_REQUESTERS,
} from '../run/context-contracts';
import {
  RUNTIME_EVENT_PERSIST_MODES,
  RUNTIME_EVENT_SCHEMA_VERSION,
  RUNTIME_EVENT_SOURCES,
  RUNTIME_EVENT_TYPES,
  RUNTIME_EVENT_VISIBILITIES,
  type RuntimeEvent,
  type RuntimeEventEnvelopeType,
  type RuntimeEventPersistMode,
  type RuntimeEventSource,
  type RuntimeEventType,
  type RuntimeEventVisibility,
} from '../runtime/events';
import {
  APPROVAL_SCOPES,
  ApprovalRequestSchema,
  PermissionDecisionSchema,
  ToolExecutionSchema,
  ToolPolicyDecisionSchema,
  type ApprovalScope,
} from '../tool/contracts';
import {
  CancelReasonSchema,
  CancelRequestedBySchema,
  CancelScopeSchema,
  CheckpointBoundarySchema,
  CheckpointReasonSchema,
  ResumeModeSchema,
  ResumeReasonSchema,
  ResumeRequestedBySchema,
  RetryKindSchema,
  RetryReasonSchema,
  RetryRequestedBySchema,
} from '../recovery/contracts';
import {
  ArtifactContentStorageSchema,
  ArtifactContentTypeSchema,
  ArtifactKindSchema,
  ArtifactStatusSchema,
} from '../artifact/contracts';
import {
  MemoryAccessKindSchema,
  MemoryCandidateStatusSchema,
  MemoryKindSchema,
  MemoryRecordStatusSchema,
  MemoryRiskLevelSchema,
  MemoryScopeSchema,
} from '../memory/contracts';
import {
  WorkspaceRestoreRequestedBySchema,
  WorkspaceRestoreResultStatusSchema,
} from '../workspace/change-contracts';

const RUNTIME_EVENT_TYPE_VALUES = [...RUNTIME_EVENT_TYPES] as [
  RuntimeEventType,
  ...RuntimeEventType[],
];
const RUNTIME_EVENT_SOURCE_VALUES = [...RUNTIME_EVENT_SOURCES] as [
  RuntimeEventSource,
  ...RuntimeEventSource[],
];
const RUNTIME_EVENT_VISIBILITY_VALUES = [...RUNTIME_EVENT_VISIBILITIES] as [
  RuntimeEventVisibility,
  ...RuntimeEventVisibility[],
];
const RUNTIME_EVENT_PERSIST_MODE_VALUES = [...RUNTIME_EVENT_PERSIST_MODES] as [
  RuntimeEventPersistMode,
  ...RuntimeEventPersistMode[],
];
const APPROVAL_SCOPE_VALUES = [...APPROVAL_SCOPES] as [ApprovalScope, ...ApprovalScope[]];

export const RuntimeEventTypeSchema = z.enum(RUNTIME_EVENT_TYPE_VALUES);
export const RuntimeEventSourceSchema = z.enum(RUNTIME_EVENT_SOURCE_VALUES);
export const RuntimeEventVisibilitySchema = z.enum(RUNTIME_EVENT_VISIBILITY_VALUES);
export const RuntimeEventPersistModeSchema = z.enum(RUNTIME_EVENT_PERSIST_MODE_VALUES);

export const RuntimeEventIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9:_-]+$/, 'Event id must contain only letters, numbers, colon, underscore, or hyphen.');

export const RuntimeEventSequenceSchema = z.number().int().positive();
export const RuntimeEventIsoDateTimeSchema = z.string().datetime({ offset: true });

const RuntimeEventBaseSchema = z
  .object({
    eventId: RuntimeEventIdSchema,
    schemaVersion: z.literal(RUNTIME_EVENT_SCHEMA_VERSION),
    runId: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
    stepId: z.string().min(1).optional(),
    actionId: z.string().min(1).optional(),
    observationId: z.string().min(1).optional(),
    messageId: z.string().min(1).optional(),
    requestId: z.string().min(1).optional(),
    context: RuntimeContextSchema.optional(),
    sequence: RuntimeEventSequenceSchema,
    createdAt: RuntimeEventIsoDateTimeSchema,
    source: RuntimeEventSourceSchema,
    visibility: RuntimeEventVisibilitySchema,
    persist: RuntimeEventPersistModeSchema,
  })
  .strict();

const ChatUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional(),
  })
  .strict();

const RunScopedRuntimeEventBaseSchema = RuntimeEventBaseSchema.extend({
  runId: z.string().min(1),
}).strict();

const SessionScopedRuntimeEventBaseSchema = RuntimeEventBaseSchema.extend({
  sessionId: z.string().min(1),
  runId: z.undefined().optional(),
}).strict();

const SessionCreatedPayloadSchema = z
  .object({
    title: z.string().min(1),
    status: SessionStatusSchema,
  })
  .strict();

const SessionUpdatedPayloadSchema = z
  .object({
    changedFields: z.array(z.string().min(1)).min(1),
  })
  .strict();

const SessionActiveLeafChangedPayloadSchema = z
  .object({
    previousLeafSourceEntryId: z.string().min(1).optional(),
    leafSourceEntryId: z.string().min(1).optional(),
    reason: z.enum(SESSION_ACTIVE_LEAF_REASONS),
    sourceRef: ModelInputContextSourceRefSchema.optional(),
  })
  .strict();

const SessionBranchMarkerCreatedPayloadSchema = z
  .object({
    branchMarkerId: z.string().min(1),
    branchMarkerSourceEntryId: z.string().min(1),
    previousLeafSourceEntryId: z.string().min(1).optional(),
    targetLeafSourceEntryId: z.string().min(1).optional(),
    selectedSourceRef: ModelInputContextSourceRefSchema,
    seedSourceRef: ModelInputContextSourceRefSchema.optional(),
    reason: z.enum(SESSION_BRANCH_MARKER_REASONS),
  })
  .strict();

const SessionBranchDraftCancelledPayloadSchema = z
  .object({
    branchMarkerId: z.string().min(1),
    branchMarkerSourceEntryId: z.string().min(1),
    restoredLeafSourceEntryId: z.string().min(1).optional(),
    reason: z.literal('branch_cancelled'),
  })
  .strict();

const RunCreatedPayloadSchema = z
  .object({
    status: RunStatusSchema,
    mode: z.string().min(1),
    goal: z.string().min(1),
    triggerMessageId: z.string().min(1).optional(),
  })
  .strict();

const RunStartedPayloadSchema = z
  .object({
    providerId: z.string().min(1).optional(),
    modelId: z.string().min(1).optional(),
    runKind: z.enum(['chat', 'agent']),
  })
  .strict();

const RunStatusChangedPayloadSchema = z
  .object({
    from: RunStatusSchema,
    to: RunStatusSchema,
  })
  .strict();

const StepCreatedPayloadSchema = z
  .object({
    kind: RunStepKindSchema,
    status: RunStepStatusSchema,
    title: z.string().min(1).optional(),
  })
  .strict();

const StepStartedPayloadSchema = z.object({ kind: RunStepKindSchema }).strict();

const StepStatusChangedPayloadSchema = z
  .object({
    from: RunStepStatusSchema,
    to: RunStepStatusSchema,
  })
  .strict();

const StepCompletedPayloadSchema = z.object({ kind: RunStepKindSchema }).strict();

const StepFailedPayloadSchema = z
  .object({
    kind: RunStepKindSchema,
    error: RuntimeErrorSchema,
  })
  .strict();

const ActionRequestedPayloadSchema = z
  .object({
    kind: RunActionKindSchema,
    status: RunActionStatusSchema,
    inputPreview: JsonObjectSchema.optional(),
  })
  .strict();

const ObservationReceivedPayloadSchema = z
  .object({
    source: RunObservationSourceSchema,
    kind: z.string().min(1),
    summary: z.string().optional(),
  })
  .strict();

const ContextPatchRequestedPayloadSchema = z
  .object({
    patchId: z.string().min(1),
    operation: z.enum(CONTEXT_PATCH_OPERATIONS),
    requestedBy: z.enum(CONTEXT_PATCH_REQUESTERS),
    reason: z.string().min(1),
  })
  .strict();

const ContextPatchAppliedPayloadSchema = z
  .object({
    patchId: z.string().min(1),
    operation: z.enum(CONTEXT_PATCH_OPERATIONS),
    effectiveContextBuildId: z.string().min(1).optional(),
  })
  .strict();

const ContextPatchRejectedPayloadSchema = z
  .object({
    patchId: z.string().min(1),
    operation: z.enum(CONTEXT_PATCH_OPERATIONS),
    rejectionReason: z.string().min(1),
  })
  .strict();

const ContextEffectiveUpdatedPayloadSchema = z
  .object({
    contextId: z.string().min(1),
    effectiveContextBuildId: z.string().min(1),
    sourceCount: z.number().int().nonnegative(),
    redactionCount: z.number().int().nonnegative(),
    truncationCount: z.number().int().nonnegative(),
  })
  .strict();

const SessionCompactionTriggerReasonSchema = z.enum(SESSION_COMPACTION_TRIGGER_REASONS);

const ContextCompactionStartedPayloadSchema = z
  .object({
    compactionId: z.string().min(1).max(128),
    triggerReason: SessionCompactionTriggerReasonSchema,
    tokensBefore: z.number().int().nonnegative(),
    firstKeptSourceRef: ModelInputContextSourceRefSchema,
    summarizedSourceCount: z.number().int().nonnegative(),
    previousCompactionId: z.string().min(1).max(128).optional(),
  })
  .strict();

const ContextCompactionCompletedPayloadSchema = ContextCompactionStartedPayloadSchema.extend({
  readFiles: z.array(z.string().min(1)).optional(),
  modifiedFiles: z.array(z.string().min(1)).optional(),
}).strict();

const ContextCompactionFailedPayloadSchema = z
  .object({
    triggerReason: SessionCompactionTriggerReasonSchema,
    tokensBefore: z.number().int().nonnegative(),
    previousCompactionId: z.string().min(1).max(128).optional(),
    error: RuntimeErrorSchema,
  })
  .strict();

const MessageDeltaPayloadSchema = z
  .object({
    messageId: z.string().min(1),
    delta: z.string(),
  })
  .strict();

const MessageCompletedPayloadSchema = z
  .object({
    messageId: z.string().min(1),
    status: SessionMessageStatusSchema,
  })
  .strict();

const ErrorRaisedPayloadSchema = z.object({ error: RuntimeErrorSchema }).strict();

const AssistantOutputDeltaPayloadSchema = z.object({ delta: z.string() }).strict();

const AssistantOutputCompletedPayloadSchema = z
  .object({
    content: z.string(),
    messageId: z.string().min(1).optional(),
    usage: ChatUsageSchema.optional(),
  })
  .strict();

const ModelStepStartedPayloadSchema = z
  .object({
    modelStepId: z.string().min(1),
    providerId: z.string().min(1),
    modelId: z.string().min(1),
  })
  .strict();

const ModelOutputDeltaPayloadSchema = z
  .object({
    modelStepId: z.string().min(1),
    delta: z.string(),
  })
  .strict();

const ProviderStateBlockSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('reasoning_content'),
      text: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('thinking'),
      text: z.string(),
      signature: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('redacted_thinking'),
      data: z.string().min(1),
    })
    .strict(),
]);

const ModelStepProviderStateRecordedPayloadSchema = z
  .object({
    modelStepId: z.string().min(1),
    providerId: z.string().min(1),
    modelId: z.string().min(1),
    blocks: z.array(ProviderStateBlockSchema).min(1),
  })
  .strict();

const ModelThinkingStartedPayloadSchema = z
  .object({
    modelStepId: z.string().min(1),
  })
  .strict();

const ModelThinkingDeltaPayloadSchema = z
  .object({
    modelStepId: z.string().min(1),
    delta: z.string(),
  })
  .strict();

const ModelThinkingCompletedPayloadSchema = z
  .object({
    modelStepId: z.string().min(1),
  })
  .strict();

const ModelToolCallDetectedPayloadSchema = z
  .object({
    modelStepId: z.string().min(1),
    toolCallId: z.string().min(1),
    providerToolCallId: z.string().min(1),
    toolName: z.string().min(1),
  })
  .strict();

const ModelStepCompletedPayloadSchema = z
  .object({
    modelStepId: z.string().min(1),
    finishReason: z.string().min(1).optional(),
  })
  .strict();

const ToolCallCreatedPayloadSchema = z
  .object({
    toolCallId: z.string().min(1),
    modelStepId: z.string().min(1),
    providerToolCallId: z.string().min(1),
    toolName: z.string().min(1),
    input: JsonValueSchema,
  })
  .strict();

const ToolResultCreatedPayloadSchema = z
  .object({
    toolResultId: z.string().min(1),
    toolCallId: z.string().min(1),
    toolExecutionId: z.string().min(1).optional(),
    kind: z.enum([
      'success',
      'tool_error',
      'policy_denied',
      'user_rejected',
      'redacted',
      'invalid_tool_call',
      'invalid_tool_input',
    ]),
    summary: z.string().min(1),
  })
  .strict();

const RunCompletedPayloadSchema = z.object({ usage: ChatUsageSchema.optional() }).strict();
const RunFailedPayloadSchema = z.object({ error: RuntimeErrorSchema }).strict();
const RunCancelledPayloadSchema = z
  .object({
    reason: z.string().min(1).optional(),
    error: RuntimeErrorSchema.optional(),
  })
  .strict();

const RunInterruptedPayloadSchema = z
  .object({
    interruptedMarkerId: z.string().min(1),
    previousStatus: z.enum(SESSION_INTERRUPTED_RUN_PREVIOUS_STATUSES),
    reason: z.enum(SESSION_INTERRUPTED_RUN_REASONS),
  })
  .strict();

const RunWaitingForApprovalPayloadSchema = z
  .object({
    approvalRequestId: z.string().min(1),
    toolCallId: z.string().min(1),
    toolExecutionId: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict();

const CheckpointCreatedPayloadSchema = z
  .object({
    checkpointId: z.string().min(1),
    reason: CheckpointReasonSchema,
    boundary: CheckpointBoundarySchema,
    stateSummary: z.string().min(1),
  })
  .strict();

const CheckpointRestoredPayloadSchema = z
  .object({
    checkpointId: z.string().min(1),
    resumeRequestId: z.string().min(1).optional(),
    reason: ResumeReasonSchema,
  })
  .strict();

const CheckpointStatusChangePayloadSchema = z
  .object({
    checkpointId: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict();

const RunResumeRequestedPayloadSchema = z
  .object({
    resumeRequestId: z.string().min(1),
    requestedBy: ResumeRequestedBySchema,
    reason: ResumeReasonSchema,
    resumeMode: ResumeModeSchema,
    checkpointId: z.string().min(1).optional(),
  })
  .strict();

const RunResumedPayloadSchema = z
  .object({
    resumeRequestId: z.string().min(1),
    checkpointId: z.string().min(1).optional(),
  })
  .strict();

const RunResumeFailedPayloadSchema = z
  .object({
    resumeRequestId: z.string().min(1),
    error: RuntimeErrorSchema,
  })
  .strict();

const RunCancelRequestedPayloadSchema = z
  .object({
    cancelRequestId: z.string().min(1),
    requestedBy: CancelRequestedBySchema,
    reason: CancelReasonSchema,
    scope: CancelScopeSchema,
  })
  .strict();

const RunCancellingPayloadSchema = z
  .object({
    cancelRequestId: z.string().min(1),
  })
  .strict();

const CancelledPayloadSchema = z
  .object({
    cancelRequestId: z.string().min(1),
    reason: CancelReasonSchema.optional(),
  })
  .strict();

const RunRetryRequestedPayloadSchema = z
  .object({
    retryRequestId: z.string().min(1),
    requestedBy: RetryRequestedBySchema,
    retryKind: RetryKindSchema,
    reason: RetryReasonSchema,
    attemptNumber: z.number().int().positive().optional(),
    checkpointId: z.string().min(1).optional(),
  })
  .strict();

const RetryStartedPayloadSchema = z
  .object({
    retryRequestId: z.string().min(1),
    retryKind: RetryKindSchema,
    checkpointId: z.string().min(1).optional(),
  })
  .strict();

const RetryCompletedPayloadSchema = z
  .object({
    retryRequestId: z.string().min(1),
    retryKind: RetryKindSchema,
  })
  .strict();

const RetryFailedPayloadSchema = z
  .object({
    retryRequestId: z.string().min(1),
    retryKind: RetryKindSchema,
    error: RuntimeErrorSchema,
  })
  .strict();

const ToolExecutionRequestedPayloadSchema = z
  .object({
    toolExecution: ToolExecutionSchema,
  })
  .strict();

const ToolExecutionValidatedPayloadSchema = z
  .object({
    toolExecutionId: z.string().min(1),
    toolName: z.string().min(1),
  })
  .strict();

const ToolExecutionPolicyDecidedPayloadSchema = z
  .object({
    toolExecutionId: z.string().min(1),
    toolName: z.string().min(1),
    policyDecision: ToolPolicyDecisionSchema,
  })
  .strict();

const PermissionDecisionCreatedPayloadSchema = z
  .object({
    permissionDecision: PermissionDecisionSchema,
  })
  .strict();

const ToolExecutionApprovalRequestedPayloadSchema = z
  .object({
    toolExecutionId: z.string().min(1),
    toolName: z.string().min(1),
    approvalRequest: ApprovalRequestSchema,
  })
  .strict();

const ToolExecutionStartedPayloadSchema = z
  .object({
    toolExecutionId: z.string().min(1),
    startedAt: RuntimeEventIsoDateTimeSchema.optional(),
  })
  .strict();

const ToolExecutionCompletedPayloadSchema = z
  .object({
    toolExecutionId: z.string().min(1),
    completedAt: RuntimeEventIsoDateTimeSchema.optional(),
  })
  .strict();

const ToolExecutionFailedPayloadSchema = z
  .object({
    toolExecutionId: z.string().min(1),
    error: RuntimeErrorSchema,
    completedAt: RuntimeEventIsoDateTimeSchema.optional(),
  })
  .strict();

const ToolExecutionDeniedPayloadSchema = z
  .object({
    toolExecutionId: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict();

const ApprovalRequestedPayloadSchema = z
  .object({
    approvalRequest: ApprovalRequestSchema,
  })
  .strict();

const ApprovalResolvedPayloadSchema = z
  .object({
    approvalRequestId: z.string().min(1),
    decision: z.enum(['approved', 'denied', 'expired', 'cancelled']),
    scope: z.enum(APPROVAL_SCOPE_VALUES),
    decidedAt: RuntimeEventIsoDateTimeSchema,
  })
  .strict();

const ApprovalExpiredPayloadSchema = z
  .object({
    approvalRequestId: z.string().min(1),
    toolCallId: z.string().min(1).optional(),
    expiredAt: RuntimeEventIsoDateTimeSchema,
  })
  .strict();

const ArtifactCreatedPayloadSchema = z
  .object({
    artifactId: z.string().min(1),
    artifactVersionId: z.string().min(1).optional(),
    kind: ArtifactKindSchema,
    title: z.string().min(1),
    status: ArtifactStatusSchema,
  })
  .strict();

const ArtifactVersionCreatedPayloadSchema = z
  .object({
    artifactId: z.string().min(1),
    artifactVersionId: z.string().min(1),
    versionNumber: z.number().int().positive(),
    contentType: ArtifactContentTypeSchema,
    textPreview: z.string(),
  })
  .strict();

const ArtifactStatusChangedPayloadSchema = z
  .object({
    artifactId: z.string().min(1),
    from: ArtifactStatusSchema,
    to: ArtifactStatusSchema,
  })
  .strict();

const ArtifactReferencedPayloadSchema = z
  .object({
    artifactId: z.string().min(1),
    artifactVersionId: z.string().min(1).optional(),
    referencedByKind: z.enum(['run', 'step', 'artifact', 'message']),
    referencedById: z.string().min(1),
  })
  .strict();

const ArtifactContentWriteFailedPayloadSchema = z
  .object({
    artifactId: z.string().min(1).optional(),
    artifactVersionId: z.string().min(1).optional(),
    storage: ArtifactContentStorageSchema,
    error: RuntimeErrorSchema,
  })
  .strict();

const MemoryCandidateProposedPayloadSchema = z
  .object({
    candidateId: z.string().min(1),
    scope: MemoryScopeSchema,
    kind: MemoryKindSchema,
    status: MemoryCandidateStatusSchema,
    riskLevel: MemoryRiskLevelSchema,
    summary: z.string().min(1),
    sourceRefCount: z.number().int().nonnegative(),
  })
  .strict();

const MemoryCandidateAcceptedPayloadSchema = z
  .object({
    candidateId: z.string().min(1),
    memoryId: z.string().min(1),
    reviewedAt: RuntimeEventIsoDateTimeSchema,
  })
  .strict();

const MemoryCandidateRejectedPayloadSchema = z
  .object({
    candidateId: z.string().min(1),
    rejectionReason: z.string().min(1),
    reviewedAt: RuntimeEventIsoDateTimeSchema,
  })
  .strict();

const MemoryRecordCreatedPayloadSchema = z
  .object({
    memoryId: z.string().min(1),
    scope: MemoryScopeSchema,
    kind: MemoryKindSchema,
    status: MemoryRecordStatusSchema,
    summary: z.string().min(1),
  })
  .strict();

const MemoryRecordUpdatedPayloadSchema = z
  .object({
    memoryId: z.string().min(1),
    changedFields: z.array(z.string().min(1)).min(1),
  })
  .strict();

const MemoryRecordStatusChangedPayloadSchema = z
  .object({
    memoryId: z.string().min(1),
    from: MemoryRecordStatusSchema,
    to: MemoryRecordStatusSchema,
    reason: z.string().min(1).optional(),
  })
  .strict();

const MemoryRecallRequestedPayloadSchema = z
  .object({
    recallRequestId: z.string().min(1),
    scopes: z.array(MemoryScopeSchema).min(1),
    kinds: z.array(MemoryKindSchema).optional(),
    limit: z.number().int().positive(),
  })
  .strict();

const MemoryRecallCompletedPayloadSchema = z
  .object({
    recallRequestId: z.string().min(1),
    resultCount: z.number().int().nonnegative(),
    selectedCount: z.number().int().nonnegative(),
  })
  .strict();

const MemoryRecallFailedPayloadSchema = z
  .object({
    recallRequestId: z.string().min(1),
    error: RuntimeErrorSchema,
  })
  .strict();

const MemoryAccessRecordedPayloadSchema = z
  .object({
    accessLogId: z.string().min(1),
    memoryId: z.string().min(1),
    accessKind: MemoryAccessKindSchema,
    selectedForContext: z.boolean(),
  })
  .strict();

const WorkspaceRestoreRequestedPayloadSchema = z
  .object({
    restoreRequestId: z.string().min(1),
    changeSetId: z.string().min(1),
    requestedBy: WorkspaceRestoreRequestedBySchema,
  })
  .strict();

const WorkspaceRestoreCompletedPayloadSchema = z
  .object({
    restoreRequestId: z.string().min(1),
    restoreResultId: z.string().min(1),
    changeSetId: z.string().min(1),
    status: WorkspaceRestoreResultStatusSchema,
    changedFileCount: z.number().int().nonnegative(),
    restoredCount: z.number().int().nonnegative(),
    conflictCount: z.number().int().nonnegative(),
    failedCount: z.number().int().nonnegative(),
    noopCount: z.number().int().nonnegative(),
  })
  .strict();

function eventSchema<TType extends RuntimeEventEnvelopeType, TPayloadSchema extends z.ZodTypeAny>(
  eventType: TType,
  payload: TPayloadSchema,
) {
  return RunScopedRuntimeEventBaseSchema.extend({
    eventType: z.literal(eventType),
    payload,
  }).strict();
}

function sessionEventSchema<TType extends 'session.created' | 'session.updated', TPayloadSchema extends z.ZodTypeAny>(
  eventType: TType,
  payload: TPayloadSchema,
) {
  return RuntimeEventBaseSchema.extend({
    eventType: z.literal(eventType),
    payload,
  }).strict();
}

function sessionScopedEventSchema<TType extends RuntimeEventType, TPayloadSchema extends z.ZodTypeAny>(
  eventType: TType,
  payload: TPayloadSchema,
) {
  return SessionScopedRuntimeEventBaseSchema.extend({
    eventType: z.literal(eventType),
    payload,
  }).strict();
}

export const SessionCreatedEventSchema = sessionEventSchema('session.created', SessionCreatedPayloadSchema);
export const SessionUpdatedEventSchema = sessionEventSchema('session.updated', SessionUpdatedPayloadSchema);
export const SessionActiveLeafChangedEventSchema = sessionScopedEventSchema(
  'session.active_leaf.changed',
  SessionActiveLeafChangedPayloadSchema,
);
export const SessionBranchMarkerCreatedEventSchema = sessionScopedEventSchema(
  'session.branch_marker.created',
  SessionBranchMarkerCreatedPayloadSchema,
);
export const SessionBranchDraftCancelledEventSchema = sessionScopedEventSchema(
  'session.branch_draft.cancelled',
  SessionBranchDraftCancelledPayloadSchema,
);
export const RunCreatedEventSchema = eventSchema('run.created', RunCreatedPayloadSchema);
export const RunStartedEventSchema = eventSchema('run.started', RunStartedPayloadSchema);
export const RunStatusChangedEventSchema = eventSchema('run.status.changed', RunStatusChangedPayloadSchema);
export const RunCompletedEventSchema = eventSchema('run.completed', RunCompletedPayloadSchema);
export const RunFailedEventSchema = eventSchema('run.failed', RunFailedPayloadSchema);
export const RunCancelledEventSchema = eventSchema('run.cancelled', RunCancelledPayloadSchema);
export const RunInterruptedEventSchema = eventSchema('run.interrupted', RunInterruptedPayloadSchema);
export const RunWaitingForApprovalEventSchema = eventSchema(
  'run.waiting_for_approval',
  RunWaitingForApprovalPayloadSchema,
);
export const StepCreatedEventSchema = eventSchema('step.created', StepCreatedPayloadSchema);
export const StepStartedEventSchema = eventSchema('step.started', StepStartedPayloadSchema);
export const StepStatusChangedEventSchema = eventSchema('step.status.changed', StepStatusChangedPayloadSchema);
export const StepCompletedEventSchema = eventSchema('step.completed', StepCompletedPayloadSchema);
export const StepFailedEventSchema = eventSchema('step.failed', StepFailedPayloadSchema);
export const ActionRequestedEventSchema = eventSchema('action.requested', ActionRequestedPayloadSchema);
export const ObservationReceivedEventSchema = eventSchema('observation.received', ObservationReceivedPayloadSchema);
export const ContextPatchRequestedEventSchema = eventSchema(
  'context.patch.requested',
  ContextPatchRequestedPayloadSchema,
);
export const ContextPatchAppliedEventSchema = eventSchema(
  'context.patch.applied',
  ContextPatchAppliedPayloadSchema,
);
export const ContextPatchRejectedEventSchema = eventSchema(
  'context.patch.rejected',
  ContextPatchRejectedPayloadSchema,
);
export const ContextEffectiveUpdatedEventSchema = eventSchema(
  'context.effective.updated',
  ContextEffectiveUpdatedPayloadSchema,
);
export const ContextCompactionStartedEventSchema = eventSchema(
  'context.compaction.started',
  ContextCompactionStartedPayloadSchema,
);
export const ContextCompactionCompletedEventSchema = eventSchema(
  'context.compaction.completed',
  ContextCompactionCompletedPayloadSchema,
);
export const ContextCompactionFailedEventSchema = eventSchema(
  'context.compaction.failed',
  ContextCompactionFailedPayloadSchema,
);
export const MessageDeltaEventSchema = eventSchema('message.delta', MessageDeltaPayloadSchema);
export const MessageCompletedEventSchema = eventSchema('message.completed', MessageCompletedPayloadSchema);
export const ErrorRaisedEventSchema = eventSchema('error.raised', ErrorRaisedPayloadSchema);
export const AssistantOutputDeltaEventSchema = eventSchema('assistant.output.delta', AssistantOutputDeltaPayloadSchema);
export const AssistantOutputCompletedEventSchema = eventSchema(
  'assistant.output.completed',
  AssistantOutputCompletedPayloadSchema,
);
export const ModelStepStartedEventSchema = eventSchema('model.step.started', ModelStepStartedPayloadSchema);
export const ModelOutputDeltaEventSchema = eventSchema('model.output.delta', ModelOutputDeltaPayloadSchema);
export const ModelStepProviderStateRecordedEventSchema = eventSchema(
  'model.step.provider_state.recorded',
  ModelStepProviderStateRecordedPayloadSchema,
);
export const ModelThinkingStartedEventSchema = eventSchema(
  'model.thinking.started',
  ModelThinkingStartedPayloadSchema,
);
export const ModelThinkingDeltaEventSchema = eventSchema(
  'model.thinking.delta',
  ModelThinkingDeltaPayloadSchema,
);
export const ModelThinkingCompletedEventSchema = eventSchema(
  'model.thinking.completed',
  ModelThinkingCompletedPayloadSchema,
);
export const ModelToolCallDetectedEventSchema = eventSchema('model.tool_call.detected', ModelToolCallDetectedPayloadSchema);
export const ModelStepCompletedEventSchema = eventSchema('model.step.completed', ModelStepCompletedPayloadSchema);
export const ToolCallCreatedEventSchema = eventSchema('tool.call.created', ToolCallCreatedPayloadSchema);
export const ToolResultCreatedEventSchema = eventSchema('tool.result.created', ToolResultCreatedPayloadSchema);
export const ToolExecutionRequestedEventSchema = eventSchema(
  'tool.execution.requested',
  ToolExecutionRequestedPayloadSchema,
);
export const ToolExecutionValidatedEventSchema = eventSchema('tool.execution.validated', ToolExecutionValidatedPayloadSchema);
export const ToolExecutionPolicyDecidedEventSchema = eventSchema(
  'tool.execution.policy_decided',
  ToolExecutionPolicyDecidedPayloadSchema,
);
export const PermissionDecisionCreatedEventSchema = eventSchema(
  'permission.decision.created',
  PermissionDecisionCreatedPayloadSchema,
);
export const ToolExecutionApprovalRequestedEventSchema = eventSchema(
  'tool.execution.approval_requested',
  ToolExecutionApprovalRequestedPayloadSchema,
);
export const ToolExecutionStartedEventSchema = eventSchema('tool.execution.started', ToolExecutionStartedPayloadSchema);
export const ToolExecutionCompletedEventSchema = eventSchema('tool.execution.completed', ToolExecutionCompletedPayloadSchema);
export const ToolExecutionFailedEventSchema = eventSchema('tool.execution.failed', ToolExecutionFailedPayloadSchema);
export const ToolExecutionDeniedEventSchema = eventSchema('tool.execution.denied', ToolExecutionDeniedPayloadSchema);
export const ApprovalRequestedEventSchema = eventSchema('approval.requested', ApprovalRequestedPayloadSchema);
export const ApprovalResolvedEventSchema = eventSchema('approval.resolved', ApprovalResolvedPayloadSchema);
export const ApprovalExpiredEventSchema = eventSchema('approval.expired', ApprovalExpiredPayloadSchema);
export const CheckpointCreatedEventSchema = eventSchema('checkpoint.created', CheckpointCreatedPayloadSchema);
export const CheckpointRestoredEventSchema = eventSchema('checkpoint.restored', CheckpointRestoredPayloadSchema);
export const CheckpointInvalidatedEventSchema = eventSchema(
  'checkpoint.invalidated',
  CheckpointStatusChangePayloadSchema,
);
export const CheckpointDiscardedEventSchema = eventSchema(
  'checkpoint.discarded',
  CheckpointStatusChangePayloadSchema,
);
export const RunResumeRequestedEventSchema = eventSchema('run.resume.requested', RunResumeRequestedPayloadSchema);
export const RunResumedEventSchema = eventSchema('run.resumed', RunResumedPayloadSchema);
export const RunResumeFailedEventSchema = eventSchema('run.resume.failed', RunResumeFailedPayloadSchema);
export const RunCancelRequestedEventSchema = eventSchema('run.cancel.requested', RunCancelRequestedPayloadSchema);
export const RunCancellingEventSchema = eventSchema('run.cancelling', RunCancellingPayloadSchema);
export const StepCancelledEventSchema = eventSchema('step.cancelled', CancelledPayloadSchema);
export const ActionCancelledEventSchema = eventSchema('action.cancelled', CancelledPayloadSchema);
export const RunRetryRequestedEventSchema = eventSchema('run.retry.requested', RunRetryRequestedPayloadSchema);
export const StepRetryRequestedEventSchema = eventSchema('step.retry.requested', RunRetryRequestedPayloadSchema);
export const ActionRetryRequestedEventSchema = eventSchema('action.retry.requested', RunRetryRequestedPayloadSchema);
export const RetryStartedEventSchema = eventSchema('retry.started', RetryStartedPayloadSchema);
export const RetryCompletedEventSchema = eventSchema('retry.completed', RetryCompletedPayloadSchema);
export const RetryFailedEventSchema = eventSchema('retry.failed', RetryFailedPayloadSchema);
export const ArtifactCreatedEventSchema = eventSchema('artifact.created', ArtifactCreatedPayloadSchema);
export const ArtifactVersionCreatedEventSchema = eventSchema(
  'artifact.version.created',
  ArtifactVersionCreatedPayloadSchema,
);
export const ArtifactStatusChangedEventSchema = eventSchema(
  'artifact.status.changed',
  ArtifactStatusChangedPayloadSchema,
);
export const ArtifactReferencedEventSchema = eventSchema('artifact.referenced', ArtifactReferencedPayloadSchema);
export const ArtifactContentWriteFailedEventSchema = eventSchema(
  'artifact.content.write.failed',
  ArtifactContentWriteFailedPayloadSchema,
);
export const MemoryCandidateProposedEventSchema = eventSchema(
  'memory.candidate.proposed',
  MemoryCandidateProposedPayloadSchema,
);
export const MemoryCandidateAcceptedEventSchema = eventSchema(
  'memory.candidate.accepted',
  MemoryCandidateAcceptedPayloadSchema,
);
export const MemoryCandidateRejectedEventSchema = eventSchema(
  'memory.candidate.rejected',
  MemoryCandidateRejectedPayloadSchema,
);
export const MemoryRecordCreatedEventSchema = eventSchema('memory.record.created', MemoryRecordCreatedPayloadSchema);
export const MemoryRecordUpdatedEventSchema = eventSchema('memory.record.updated', MemoryRecordUpdatedPayloadSchema);
export const MemoryRecordStatusChangedEventSchema = eventSchema(
  'memory.record.status.changed',
  MemoryRecordStatusChangedPayloadSchema,
);
export const MemoryRecallRequestedEventSchema = eventSchema('memory.recall.requested', MemoryRecallRequestedPayloadSchema);
export const MemoryRecallCompletedEventSchema = eventSchema('memory.recall.completed', MemoryRecallCompletedPayloadSchema);
export const MemoryRecallFailedEventSchema = eventSchema('memory.recall.failed', MemoryRecallFailedPayloadSchema);
export const MemoryAccessRecordedEventSchema = eventSchema('memory.access.recorded', MemoryAccessRecordedPayloadSchema);
export const WorkspaceRestoreRequestedEventSchema = eventSchema(
  'workspace.restore.requested',
  WorkspaceRestoreRequestedPayloadSchema,
);
export const WorkspaceRestoreCompletedEventSchema = eventSchema(
  'workspace.restore.completed',
  WorkspaceRestoreCompletedPayloadSchema,
);

export const RuntimeEventSchema = z.discriminatedUnion('eventType', [
  SessionCreatedEventSchema,
  SessionUpdatedEventSchema,
  SessionActiveLeafChangedEventSchema,
  SessionBranchMarkerCreatedEventSchema,
  SessionBranchDraftCancelledEventSchema,
  RunCreatedEventSchema,
  RunStartedEventSchema,
  RunStatusChangedEventSchema,
  RunCompletedEventSchema,
  RunFailedEventSchema,
  RunCancelledEventSchema,
  RunInterruptedEventSchema,
  RunWaitingForApprovalEventSchema,
  StepCreatedEventSchema,
  StepStartedEventSchema,
  StepStatusChangedEventSchema,
  StepCompletedEventSchema,
  StepFailedEventSchema,
  ActionRequestedEventSchema,
  ObservationReceivedEventSchema,
  ContextPatchRequestedEventSchema,
  ContextPatchAppliedEventSchema,
  ContextPatchRejectedEventSchema,
  ContextEffectiveUpdatedEventSchema,
  ContextCompactionStartedEventSchema,
  ContextCompactionCompletedEventSchema,
  ContextCompactionFailedEventSchema,
  MessageDeltaEventSchema,
  MessageCompletedEventSchema,
  ErrorRaisedEventSchema,
  AssistantOutputDeltaEventSchema,
  AssistantOutputCompletedEventSchema,
  ModelStepStartedEventSchema,
  ModelOutputDeltaEventSchema,
  ModelStepProviderStateRecordedEventSchema,
  ModelThinkingStartedEventSchema,
  ModelThinkingDeltaEventSchema,
  ModelThinkingCompletedEventSchema,
  ModelToolCallDetectedEventSchema,
  ModelStepCompletedEventSchema,
  ToolCallCreatedEventSchema,
  ToolResultCreatedEventSchema,
  ToolExecutionRequestedEventSchema,
  ToolExecutionValidatedEventSchema,
  ToolExecutionPolicyDecidedEventSchema,
  PermissionDecisionCreatedEventSchema,
  ToolExecutionApprovalRequestedEventSchema,
  ToolExecutionStartedEventSchema,
  ToolExecutionCompletedEventSchema,
  ToolExecutionFailedEventSchema,
  ToolExecutionDeniedEventSchema,
  ApprovalRequestedEventSchema,
  ApprovalResolvedEventSchema,
  ApprovalExpiredEventSchema,
  CheckpointCreatedEventSchema,
  CheckpointRestoredEventSchema,
  CheckpointInvalidatedEventSchema,
  CheckpointDiscardedEventSchema,
  RunResumeRequestedEventSchema,
  RunResumedEventSchema,
  RunResumeFailedEventSchema,
  RunCancelRequestedEventSchema,
  RunCancellingEventSchema,
  StepCancelledEventSchema,
  ActionCancelledEventSchema,
  RunRetryRequestedEventSchema,
  StepRetryRequestedEventSchema,
  ActionRetryRequestedEventSchema,
  RetryStartedEventSchema,
  RetryCompletedEventSchema,
  RetryFailedEventSchema,
  ArtifactCreatedEventSchema,
  ArtifactVersionCreatedEventSchema,
  ArtifactStatusChangedEventSchema,
  ArtifactReferencedEventSchema,
  ArtifactContentWriteFailedEventSchema,
  MemoryCandidateProposedEventSchema,
  MemoryCandidateAcceptedEventSchema,
  MemoryCandidateRejectedEventSchema,
  MemoryRecordCreatedEventSchema,
  MemoryRecordUpdatedEventSchema,
  MemoryRecordStatusChangedEventSchema,
  MemoryRecallRequestedEventSchema,
  MemoryRecallCompletedEventSchema,
  MemoryRecallFailedEventSchema,
  MemoryAccessRecordedEventSchema,
  WorkspaceRestoreRequestedEventSchema,
  WorkspaceRestoreCompletedEventSchema,
]);

export { isTerminalRuntimeEvent } from '../runtime/events';

export function createRuntimeEventSchema<TType extends RuntimeEventType, TPayload extends object>(
  eventType: TType,
  payload: TPayload,
): Pick<RuntimeEvent<TPayload>, 'eventType' | 'payload'> {
  return { eventType, payload };
}

export type RuntimeEventFromSchema = z.infer<typeof RuntimeEventSchema>;

