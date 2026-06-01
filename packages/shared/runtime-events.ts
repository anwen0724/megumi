import type { JsonValue } from './json';
import type { RuntimeError } from './runtime-errors';
import type { RuntimeContext } from './runtime-context';
import type { ModelInputContextSourceRef } from './model-input-context-contracts';
import type {
  SessionActiveLeafReason,
  SessionBranchMarkerReason,
  SessionInterruptedRunPreviousStatus,
  SessionInterruptedRunReason,
} from './session-active-path-contracts';
import type { SessionCompactionTriggerReason } from './session-compaction-contracts';
import type {
  RunActionKind,
  RunActionStatus,
  RunObservationSource,
  RunStatus,
  SessionMessageStatus,
  SessionStatus,
  RunStepKind,
  RunStepStatus,
} from './session-run-contracts';
import type {
  ContextEffectiveUpdatedPayload,
  ContextPatchAppliedPayload,
  ContextPatchRejectedPayload,
  ContextPatchRequestedPayload,
} from './run-context-contracts';
import type {
  ApprovalRequest,
  ApprovalScope,
  ApprovalStatus,
  PermissionDecision,
  ToolExecution,
  ToolPolicyDecision,
} from './tool-contracts';
import type {
  CancelReason,
  CancelRequestedBy,
  CancelScope,
  CheckpointBoundary,
  CheckpointReason,
  ResumeMode,
  ResumeReason,
  ResumeRequestedBy,
  RetryKind,
  RetryReason,
  RetryRequestedBy,
} from './recovery-contracts';
import type {
  ArtifactContentStorage,
  ArtifactContentType,
  ArtifactKind,
  ArtifactStatus,
} from './artifact-contracts';
import type {
  MemoryAccessKind,
  MemoryCandidateStatus,
  MemoryKind,
  MemoryRecordStatus,
  MemoryRiskLevel,
  MemoryScope,
} from './memory-contracts';
import type { ModelStepProviderState } from './model-step-contracts';

export const RUNTIME_EVENT_SCHEMA_VERSION = 1 as const;

export const RUNTIME_EVENT_TYPES = [
  'session.created',
  'session.updated',
  'session.active_leaf.changed',
  'session.branch_marker.created',
  'session.branch_draft.cancelled',
  'run.created',
  'run.started',
  'run.status.changed',
  'run.completed',
  'run.failed',
  'run.cancelled',
  'run.interrupted',
  'run.waiting_for_approval',
  'step.created',
  'step.started',
  'step.status.changed',
  'step.completed',
  'step.failed',
  'observation.received',
  'context.patch.requested',
  'context.patch.applied',
  'context.patch.rejected',
  'context.effective.updated',
  'context.compaction.started',
  'context.compaction.completed',
  'context.compaction.failed',
  'message.delta',
  'message.completed',
  'error.raised',
  'assistant.output.delta',
  'assistant.output.completed',
  'model.step.started',
  'model.output.delta',
  'model.step.provider_state.recorded',
  'model.thinking.started',
  'model.thinking.delta',
  'model.thinking.completed',
  'model.tool_call.detected',
  'model.step.completed',
  'tool.call.created',
  'tool.result.created',
  'tool.execution.requested',
  'tool.execution.validated',
  'tool.execution.policy_decided',
  'permission.decision.created',
  'tool.execution.approval_requested',
  'tool.execution.started',
  'tool.execution.completed',
  'tool.execution.failed',
  'tool.execution.denied',
  'approval.requested',
  'approval.resolved',
  'approval.expired',
  'checkpoint.created',
  'checkpoint.restored',
  'checkpoint.invalidated',
  'checkpoint.discarded',
  'run.resume.requested',
  'run.resumed',
  'run.resume.failed',
  'run.cancel.requested',
  'run.cancelling',
  'step.cancelled',
  'action.cancelled',
  'run.retry.requested',
  'step.retry.requested',
  'action.retry.requested',
  'retry.started',
  'retry.completed',
  'retry.failed',
  'artifact.created',
  'artifact.version.created',
  'artifact.status.changed',
  'artifact.referenced',
  'artifact.content.write.failed',
  'memory.candidate.proposed',
  'memory.candidate.accepted',
  'memory.candidate.rejected',
  'memory.record.created',
  'memory.record.updated',
  'memory.record.status.changed',
  'memory.recall.requested',
  'memory.recall.completed',
  'memory.recall.failed',
  'memory.access.recorded',
] as const;

export type RuntimeEventType = (typeof RUNTIME_EVENT_TYPES)[number];

export const HOST_MAINTENANCE_RUNTIME_EVENT_TYPES = [
  // Host maintenance only. Model tool execution must use tool.call/tool.execution/tool.result events.
  'action.requested',
] as const;

export type HostMaintenanceRuntimeEventType = (typeof HOST_MAINTENANCE_RUNTIME_EVENT_TYPES)[number];
export type RuntimeEventEnvelopeType = RuntimeEventType | HostMaintenanceRuntimeEventType;

export const TERMINAL_RUNTIME_EVENT_TYPES = [
  'run.completed',
  'run.failed',
  'run.cancelled',
] as const;

export type TerminalRuntimeEventType = (typeof TERMINAL_RUNTIME_EVENT_TYPES)[number];

export const RUNTIME_EVENT_SOURCES = [
  'main',
  'core',
  'provider',
  'tool',
  'approval',
  'workspace',
  'memory',
  'artifact',
  'database',
  'security',
  'unknown',
] as const;

export type RuntimeEventSource = (typeof RUNTIME_EVENT_SOURCES)[number];

export const RUNTIME_EVENT_VISIBILITIES = ['user', 'system', 'debug'] as const;

export type RuntimeEventVisibility = (typeof RUNTIME_EVENT_VISIBILITIES)[number];

export const RUNTIME_EVENT_PERSIST_MODES = ['required', 'optional', 'transient'] as const;

export type RuntimeEventPersistMode = (typeof RUNTIME_EVENT_PERSIST_MODES)[number];

export interface RuntimeEvent<TPayload extends object = object> {
  eventId: string;
  schemaVersion: typeof RUNTIME_EVENT_SCHEMA_VERSION;
  eventType: RuntimeEventEnvelopeType;
  runId?: string;
  sessionId?: string;
  stepId?: string;
  actionId?: string;
  observationId?: string;
  messageId?: string;
  requestId?: string;
  context?: RuntimeContext;
  sequence: number;
  createdAt: string;
  source: RuntimeEventSource;
  visibility: RuntimeEventVisibility;
  persist: RuntimeEventPersistMode;
  payload: TPayload;
}

export interface SessionCreatedPayload {
  title: string;
  status: SessionStatus;
}

export interface SessionUpdatedPayload {
  changedFields: string[];
}

export interface SessionActiveLeafChangedPayload {
  previousLeafSourceEntryId?: string;
  leafSourceEntryId?: string;
  reason: SessionActiveLeafReason;
  sourceRef?: ModelInputContextSourceRef;
}

export interface SessionBranchMarkerCreatedPayload {
  branchMarkerId: string;
  branchMarkerSourceEntryId: string;
  previousLeafSourceEntryId?: string;
  targetLeafSourceEntryId?: string;
  selectedSourceRef: ModelInputContextSourceRef;
  seedSourceRef?: ModelInputContextSourceRef;
  reason: SessionBranchMarkerReason;
}

export interface SessionBranchDraftCancelledPayload {
  branchMarkerId: string;
  branchMarkerSourceEntryId: string;
  restoredLeafSourceEntryId?: string;
  reason: 'branch_cancelled';
}

export interface RunCreatedPayload {
  status: RunStatus;
  mode: string;
  goal: string;
  triggerMessageId?: string;
}

export interface RunStartedPayload {
  providerId?: string;
  modelId?: string;
  runKind: 'chat' | 'agent';
}

export interface RunStatusChangedPayload {
  from: RunStatus;
  to: RunStatus;
}

export interface StepCreatedPayload {
  kind: RunStepKind;
  status: RunStepStatus;
  title?: string;
}

export interface StepStartedPayload {
  kind: RunStepKind;
}

export interface StepStatusChangedPayload {
  from: RunStepStatus;
  to: RunStepStatus;
}

export interface StepCompletedPayload {
  kind: RunStepKind;
}

export interface StepFailedPayload {
  kind: RunStepKind;
  error: RuntimeError;
}

export interface ActionRequestedPayload {
  kind: RunActionKind;
  status: RunActionStatus;
  inputPreview?: Record<string, JsonValue>;
}

export interface ObservationReceivedPayload {
  source: RunObservationSource;
  kind: string;
  summary?: string;
}

export interface ContextCompactionStartedPayload {
  compactionId: string;
  triggerReason: SessionCompactionTriggerReason;
  tokensBefore: number;
  firstKeptSourceRef: ModelInputContextSourceRef;
  summarizedSourceCount: number;
  previousCompactionId?: string;
}

export interface ContextCompactionCompletedPayload extends ContextCompactionStartedPayload {
  readFiles?: string[];
  modifiedFiles?: string[];
}

export interface ContextCompactionFailedPayload {
  triggerReason: SessionCompactionTriggerReason;
  tokensBefore: number;
  error: RuntimeError;
  previousCompactionId?: string;
}

export interface MessageDeltaPayload {
  messageId: string;
  delta: string;
}

export interface MessageCompletedPayload {
  messageId: string;
  status: SessionMessageStatus;
}

export interface ErrorRaisedPayload {
  error: RuntimeError;
}

export interface AssistantOutputDeltaPayload {
  delta: string;
}

export interface ChatTokenUsagePayload {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface AssistantOutputCompletedPayload {
  content: string;
  messageId?: string;
  usage?: ChatTokenUsagePayload;
}

export interface ModelStepStartedPayload {
  modelStepId: string;
  providerId: string;
  modelId: string;
}

export interface ModelOutputDeltaPayload {
  modelStepId: string;
  delta: string;
}

export interface ModelStepProviderStateRecordedPayload extends ModelStepProviderState {}

export interface ModelThinkingStartedPayload {
  modelStepId: string;
}

export interface ModelThinkingDeltaPayload {
  modelStepId: string;
  delta: string;
}

export interface ModelThinkingCompletedPayload {
  modelStepId: string;
}

export interface ModelToolCallDetectedPayload {
  modelStepId: string;
  toolCallId: string;
  providerToolCallId: string;
  toolName: string;
}

export interface ModelStepCompletedPayload {
  modelStepId: string;
  finishReason?: string;
}

export interface ToolCallCreatedPayload {
  toolCallId: string;
  modelStepId: string;
  providerToolCallId: string;
  toolName: string;
  input: JsonValue;
}

export interface ToolResultCreatedPayload {
  toolResultId: string;
  toolCallId: string;
  toolExecutionId?: string;
  kind: 'success' | 'tool_error' | 'policy_denied' | 'user_rejected' | 'redacted';
  summary: string;
}

export interface RunCompletedPayload {
  usage?: ChatTokenUsagePayload;
}

export interface RunFailedPayload {
  error: RuntimeError;
}

export interface RunCancelledPayload {
  reason?: string;
  error?: RuntimeError;
}

export interface RunInterruptedPayload {
  interruptedMarkerId: string;
  previousStatus: SessionInterruptedRunPreviousStatus;
  reason: SessionInterruptedRunReason;
}

export interface RunWaitingForApprovalPayload {
  approvalRequestId: string;
  toolCallId: string;
  toolExecutionId: string;
  reason: string;
}

export interface CheckpointCreatedPayload {
  checkpointId: string;
  reason: CheckpointReason;
  boundary: CheckpointBoundary;
  stateSummary: string;
}

export interface CheckpointRestoredPayload {
  checkpointId: string;
  resumeRequestId?: string;
  reason: ResumeReason;
}

export interface CheckpointInvalidatedPayload {
  checkpointId: string;
  reason: string;
}

export interface CheckpointDiscardedPayload {
  checkpointId: string;
  reason: string;
}

export interface RunResumeRequestedPayload {
  resumeRequestId: string;
  requestedBy: ResumeRequestedBy;
  reason: ResumeReason;
  resumeMode: ResumeMode;
  checkpointId?: string;
}

export interface RunResumedPayload {
  resumeRequestId: string;
  checkpointId?: string;
}

export interface RunResumeFailedPayload {
  resumeRequestId: string;
  error: RuntimeError;
}

export interface RunCancelRequestedPayload {
  cancelRequestId: string;
  requestedBy: CancelRequestedBy;
  reason: CancelReason;
  scope: CancelScope;
}

export interface RunCancellingPayload {
  cancelRequestId: string;
}

export interface StepCancelledPayload {
  cancelRequestId: string;
  reason?: CancelReason;
}

export interface ActionCancelledPayload {
  cancelRequestId: string;
  reason?: CancelReason;
}

export interface RunRetryRequestedPayload {
  retryRequestId: string;
  requestedBy: RetryRequestedBy;
  retryKind: RetryKind;
  reason: RetryReason;
  checkpointId?: string;
}

export interface RetryStartedPayload {
  retryRequestId: string;
  retryKind: RetryKind;
  checkpointId?: string;
}

export interface RetryCompletedPayload {
  retryRequestId: string;
  retryKind: RetryKind;
}

export interface RetryFailedPayload {
  retryRequestId: string;
  retryKind: RetryKind;
  error: RuntimeError;
}

export interface ToolExecutionRequestedPayload {
  toolExecution: ToolExecution;
}

export interface ToolExecutionValidatedPayload {
  toolExecutionId: string;
  toolName: string;
}

export interface ToolExecutionPolicyDecidedPayload {
  toolExecutionId: string;
  toolName: string;
  policyDecision: ToolPolicyDecision;
}

export interface PermissionDecisionCreatedPayload {
  permissionDecision: PermissionDecision;
}

export interface ToolExecutionApprovalRequestedPayload {
  toolExecutionId: string;
  toolName: string;
  approvalRequest: ApprovalRequest;
}

export interface ToolExecutionStartedPayload {
  toolExecutionId: string;
  startedAt?: string;
}

export interface ToolExecutionCompletedPayload {
  toolExecutionId: string;
  completedAt?: string;
}

export interface ToolExecutionFailedPayload {
  toolExecutionId: string;
  error: RuntimeError;
  completedAt?: string;
}

export interface ToolExecutionDeniedPayload {
  toolExecutionId: string;
  reason: string;
}

export interface ApprovalRequestedPayload {
  approvalRequest: ApprovalRequest;
}

export interface ApprovalResolvedPayload {
  approvalRequestId: string;
  decision: Exclude<ApprovalStatus, 'pending'>;
  scope: ApprovalScope;
  decidedAt: string;
}

export interface ApprovalExpiredPayload {
  approvalRequestId: string;
  toolCallId?: string;
  expiredAt: string;
}

export interface ArtifactCreatedPayload {
  artifactId: string;
  artifactVersionId?: string;
  kind: ArtifactKind;
  title: string;
  status: ArtifactStatus;
}

export interface ArtifactVersionCreatedPayload {
  artifactId: string;
  artifactVersionId: string;
  versionNumber: number;
  contentType: ArtifactContentType;
  textPreview: string;
}

export interface ArtifactStatusChangedPayload {
  artifactId: string;
  from: ArtifactStatus;
  to: ArtifactStatus;
}

export interface ArtifactReferencedPayload {
  artifactId: string;
  artifactVersionId?: string;
  referencedByKind: 'run' | 'step' | 'artifact' | 'message';
  referencedById: string;
}

export interface ArtifactContentWriteFailedPayload {
  artifactId?: string;
  artifactVersionId?: string;
  storage: ArtifactContentStorage;
  error: RuntimeError;
}

export interface MemoryCandidateProposedPayload {
  candidateId: string;
  scope: MemoryScope;
  kind: MemoryKind;
  status: MemoryCandidateStatus;
  riskLevel: MemoryRiskLevel;
  summary: string;
  sourceRefCount: number;
}

export interface MemoryCandidateAcceptedPayload {
  candidateId: string;
  memoryId: string;
  reviewedAt: string;
}

export interface MemoryCandidateRejectedPayload {
  candidateId: string;
  rejectionReason: string;
  reviewedAt: string;
}

export interface MemoryRecordCreatedPayload {
  memoryId: string;
  scope: MemoryScope;
  kind: MemoryKind;
  status: MemoryRecordStatus;
  summary: string;
}

export interface MemoryRecordUpdatedPayload {
  memoryId: string;
  changedFields: string[];
}

export interface MemoryRecordStatusChangedPayload {
  memoryId: string;
  from: MemoryRecordStatus;
  to: MemoryRecordStatus;
  reason?: string;
}

export interface MemoryRecallRequestedPayload {
  recallRequestId: string;
  scopes: MemoryScope[];
  kinds?: MemoryKind[];
  limit: number;
}

export interface MemoryRecallCompletedPayload {
  recallRequestId: string;
  resultCount: number;
  selectedCount: number;
}

export interface MemoryRecallFailedPayload {
  recallRequestId: string;
  error: RuntimeError;
}

export interface MemoryAccessRecordedPayload {
  accessLogId: string;
  memoryId: string;
  accessKind: MemoryAccessKind;
  selectedForContext: boolean;
}

export type RuntimeEventPayloadByType = {
  'session.created': SessionCreatedPayload;
  'session.updated': SessionUpdatedPayload;
  'session.active_leaf.changed': SessionActiveLeafChangedPayload;
  'session.branch_marker.created': SessionBranchMarkerCreatedPayload;
  'session.branch_draft.cancelled': SessionBranchDraftCancelledPayload;
  'run.created': RunCreatedPayload;
  'run.started': RunStartedPayload;
  'run.status.changed': RunStatusChangedPayload;
  'run.completed': RunCompletedPayload;
  'run.failed': RunFailedPayload;
  'run.cancelled': RunCancelledPayload;
  'run.interrupted': RunInterruptedPayload;
  'run.waiting_for_approval': RunWaitingForApprovalPayload;
  'step.created': StepCreatedPayload;
  'step.started': StepStartedPayload;
  'step.status.changed': StepStatusChangedPayload;
  'step.completed': StepCompletedPayload;
  'step.failed': StepFailedPayload;
  'action.requested': ActionRequestedPayload;
  'observation.received': ObservationReceivedPayload;
  'context.patch.requested': ContextPatchRequestedPayload;
  'context.patch.applied': ContextPatchAppliedPayload;
  'context.patch.rejected': ContextPatchRejectedPayload;
  'context.effective.updated': ContextEffectiveUpdatedPayload;
  'context.compaction.started': ContextCompactionStartedPayload;
  'context.compaction.completed': ContextCompactionCompletedPayload;
  'context.compaction.failed': ContextCompactionFailedPayload;
  'message.delta': MessageDeltaPayload;
  'message.completed': MessageCompletedPayload;
  'error.raised': ErrorRaisedPayload;
  'assistant.output.delta': AssistantOutputDeltaPayload;
  'assistant.output.completed': AssistantOutputCompletedPayload;
  'model.step.started': ModelStepStartedPayload;
  'model.output.delta': ModelOutputDeltaPayload;
  'model.step.provider_state.recorded': ModelStepProviderStateRecordedPayload;
  'model.thinking.started': ModelThinkingStartedPayload;
  'model.thinking.delta': ModelThinkingDeltaPayload;
  'model.thinking.completed': ModelThinkingCompletedPayload;
  'model.tool_call.detected': ModelToolCallDetectedPayload;
  'model.step.completed': ModelStepCompletedPayload;
  'tool.call.created': ToolCallCreatedPayload;
  'tool.result.created': ToolResultCreatedPayload;
  'tool.execution.requested': ToolExecutionRequestedPayload;
  'tool.execution.validated': ToolExecutionValidatedPayload;
  'tool.execution.policy_decided': ToolExecutionPolicyDecidedPayload;
  'permission.decision.created': PermissionDecisionCreatedPayload;
  'tool.execution.approval_requested': ToolExecutionApprovalRequestedPayload;
  'tool.execution.started': ToolExecutionStartedPayload;
  'tool.execution.completed': ToolExecutionCompletedPayload;
  'tool.execution.failed': ToolExecutionFailedPayload;
  'tool.execution.denied': ToolExecutionDeniedPayload;
  'approval.requested': ApprovalRequestedPayload;
  'approval.resolved': ApprovalResolvedPayload;
  'approval.expired': ApprovalExpiredPayload;
  'checkpoint.created': CheckpointCreatedPayload;
  'checkpoint.restored': CheckpointRestoredPayload;
  'checkpoint.invalidated': CheckpointInvalidatedPayload;
  'checkpoint.discarded': CheckpointDiscardedPayload;
  'run.resume.requested': RunResumeRequestedPayload;
  'run.resumed': RunResumedPayload;
  'run.resume.failed': RunResumeFailedPayload;
  'run.cancel.requested': RunCancelRequestedPayload;
  'run.cancelling': RunCancellingPayload;
  'step.cancelled': StepCancelledPayload;
  'action.cancelled': ActionCancelledPayload;
  'run.retry.requested': RunRetryRequestedPayload;
  'step.retry.requested': RunRetryRequestedPayload;
  'action.retry.requested': RunRetryRequestedPayload;
  'retry.started': RetryStartedPayload;
  'retry.completed': RetryCompletedPayload;
  'retry.failed': RetryFailedPayload;
  'artifact.created': ArtifactCreatedPayload;
  'artifact.version.created': ArtifactVersionCreatedPayload;
  'artifact.status.changed': ArtifactStatusChangedPayload;
  'artifact.referenced': ArtifactReferencedPayload;
  'artifact.content.write.failed': ArtifactContentWriteFailedPayload;
  'memory.candidate.proposed': MemoryCandidateProposedPayload;
  'memory.candidate.accepted': MemoryCandidateAcceptedPayload;
  'memory.candidate.rejected': MemoryCandidateRejectedPayload;
  'memory.record.created': MemoryRecordCreatedPayload;
  'memory.record.updated': MemoryRecordUpdatedPayload;
  'memory.record.status.changed': MemoryRecordStatusChangedPayload;
  'memory.recall.requested': MemoryRecallRequestedPayload;
  'memory.recall.completed': MemoryRecallCompletedPayload;
  'memory.recall.failed': MemoryRecallFailedPayload;
  'memory.access.recorded': MemoryAccessRecordedPayload;
};

export type TypedRuntimeEvent<TType extends RuntimeEventType> = RuntimeEvent<
  RuntimeEventPayloadByType[TType]
> & {
  eventType: TType;
};

export function isTerminalRuntimeEvent(value: RuntimeEventType): value is TerminalRuntimeEventType {
  return (TERMINAL_RUNTIME_EVENT_TYPES as readonly string[]).includes(value);
}
