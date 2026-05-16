import type { JsonValue } from './json';
import type { RuntimeError } from './runtime-errors';
import type { RuntimeContext } from './runtime-context';
import type {
  AgentActionKind,
  AgentActionStatus,
  AgentObservationSource,
  AgentRunStatus,
  AgentSessionStatus,
  AgentStepKind,
  AgentStepStatus,
  MessageStatus,
} from './agent-lifecycle-contracts';
import type {
  ContextEffectiveUpdatedPayload,
  ContextPatchAppliedPayload,
  ContextPatchRejectedPayload,
  ContextPatchRequestedPayload,
} from './agent-context-contracts';
import type {
  ApprovalScope,
  ApprovalStatus,
  ToolPolicyDecisionValue,
  ToolRiskLevel,
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
} from './agent-recovery-contracts';
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

export const RUNTIME_EVENT_SCHEMA_VERSION = 1 as const;

export const RUNTIME_EVENT_TYPES = [
  'session.created',
  'session.updated',
  'run.created',
  'run.started',
  'run.status.changed',
  'run.completed',
  'run.failed',
  'run.cancelled',
  'step.created',
  'step.started',
  'step.status.changed',
  'step.completed',
  'step.failed',
  'action.requested',
  'observation.received',
  'context.patch.requested',
  'context.patch.applied',
  'context.patch.rejected',
  'context.effective.updated',
  'message.delta',
  'message.completed',
  'error.raised',
  'assistant.output.delta',
  'assistant.output.completed',
  'tool.call.requested',
  'tool.call.validated',
  'tool.call.policy_decided',
  'tool.call.started',
  'tool.call.completed',
  'tool.call.failed',
  'tool.call.denied',
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
  eventType: RuntimeEventType;
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
  status: AgentSessionStatus;
}

export interface SessionUpdatedPayload {
  changedFields: string[];
}

export interface RunCreatedPayload {
  status: AgentRunStatus;
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
  from: AgentRunStatus;
  to: AgentRunStatus;
}

export interface StepCreatedPayload {
  kind: AgentStepKind;
  status: AgentStepStatus;
  title?: string;
}

export interface StepStartedPayload {
  kind: AgentStepKind;
}

export interface StepStatusChangedPayload {
  from: AgentStepStatus;
  to: AgentStepStatus;
}

export interface StepCompletedPayload {
  kind: AgentStepKind;
}

export interface StepFailedPayload {
  kind: AgentStepKind;
  error: RuntimeError;
}

export interface ActionRequestedPayload {
  kind: AgentActionKind;
  status: AgentActionStatus;
  inputPreview?: Record<string, JsonValue>;
}

export interface ObservationReceivedPayload {
  source: AgentObservationSource;
  kind: string;
  summary?: string;
}

export interface MessageDeltaPayload {
  messageId: string;
  delta: string;
}

export interface MessageCompletedPayload {
  messageId: string;
  status: MessageStatus;
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

export interface ToolCallRequestedPayload {
  toolCallId: string;
  toolName: string;
  inputPreview?: Record<string, JsonValue>;
  approvalRequired: boolean;
}

export interface ToolCallValidatedPayload {
  toolCallId: string;
  toolName: string;
}

export interface ToolCallPolicyDecidedPayload {
  toolCallId: string;
  toolName: string;
  decision: ToolPolicyDecisionValue;
  effectiveRiskLevel: ToolRiskLevel;
  reason: string;
}

export interface ToolCallStartedPayload {
  toolCallId: string;
  toolName: string;
}

export interface ToolCallCompletedPayload {
  toolCallId: string;
  toolName: string;
  resultPreview?: Record<string, JsonValue>;
  durationMs?: number;
}

export interface ToolCallFailedPayload {
  toolCallId: string;
  toolName: string;
  error: RuntimeError;
  durationMs?: number;
}

export interface ToolCallDeniedPayload {
  toolCallId: string;
  toolName: string;
  reason: string;
}

export interface ApprovalRequestedPayload {
  approvalId: string;
  toolCallId?: string;
  title: string;
  description: string;
  riskLevel: 'low' | 'medium' | 'high';
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
  'run.created': RunCreatedPayload;
  'run.started': RunStartedPayload;
  'run.status.changed': RunStatusChangedPayload;
  'run.completed': RunCompletedPayload;
  'run.failed': RunFailedPayload;
  'run.cancelled': RunCancelledPayload;
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
  'message.delta': MessageDeltaPayload;
  'message.completed': MessageCompletedPayload;
  'error.raised': ErrorRaisedPayload;
  'assistant.output.delta': AssistantOutputDeltaPayload;
  'assistant.output.completed': AssistantOutputCompletedPayload;
  'tool.call.requested': ToolCallRequestedPayload;
  'tool.call.validated': ToolCallValidatedPayload;
  'tool.call.policy_decided': ToolCallPolicyDecidedPayload;
  'tool.call.started': ToolCallStartedPayload;
  'tool.call.completed': ToolCallCompletedPayload;
  'tool.call.failed': ToolCallFailedPayload;
  'tool.call.denied': ToolCallDeniedPayload;
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
