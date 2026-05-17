import type {
  CancelReason,
  CancelScope,
  CheckpointBoundary,
  CheckpointReason,
  ResumeMode,
  ResumeReason,
  RetryKind,
  RetryReason,
} from '@megumi/shared/recovery-contracts';
import type { RunObservation } from '@megumi/shared/session-run-contracts';
import type { RuntimeEventPayloadByType } from '@megumi/shared/runtime-events';

interface BaseObservationInput {
  observationId: string;
  runId: string;
  stepId?: string;
  actionId?: string;
  receivedAt: string;
}

export interface CreateCheckpointObservationInput extends BaseObservationInput {
  checkpointId: string;
  reason: CheckpointReason;
  boundary: CheckpointBoundary;
  stateSummary: string;
}

export interface CreateResumeObservationInput extends BaseObservationInput {
  resumeRequestId: string;
  checkpointId?: string;
  reason: ResumeReason;
  resumeMode: ResumeMode;
}

export interface CreateCancelObservationInput extends BaseObservationInput {
  cancelRequestId: string;
  reason: CancelReason;
  scope: CancelScope;
}

export interface CreateRetryObservationInput extends BaseObservationInput {
  retryRequestId: string;
  checkpointId?: string;
  retryKind: RetryKind;
  reason: RetryReason;
}

export function createCheckpointObservation(input: CreateCheckpointObservationInput): RunObservation {
  return {
    observationId: input.observationId,
    runId: input.runId,
    stepId: input.stepId,
    actionId: input.actionId,
    source: 'checkpoint',
    kind: 'checkpoint_created',
    summary: input.stateSummary,
    receivedAt: input.receivedAt,
    metadata: {
      checkpointId: input.checkpointId,
      reason: input.reason,
      boundary: input.boundary,
      stateSummary: input.stateSummary,
    },
  };
}

export function createResumeObservation(input: CreateResumeObservationInput): RunObservation {
  return {
    observationId: input.observationId,
    runId: input.runId,
    stepId: input.stepId,
    actionId: input.actionId,
    source: 'checkpoint',
    kind: 'resume_requested',
    summary: `Resume requested: ${input.reason}`,
    receivedAt: input.receivedAt,
    metadata: {
      resumeRequestId: input.resumeRequestId,
      ...(input.checkpointId ? { checkpointId: input.checkpointId } : {}),
      reason: input.reason,
      resumeMode: input.resumeMode,
    },
  };
}

export function createCancelObservation(input: CreateCancelObservationInput): RunObservation {
  return {
    observationId: input.observationId,
    runId: input.runId,
    stepId: input.stepId,
    actionId: input.actionId,
    source: 'checkpoint',
    kind: 'cancel_requested',
    summary: `Cancel requested: ${input.reason}`,
    receivedAt: input.receivedAt,
    metadata: {
      cancelRequestId: input.cancelRequestId,
      reason: input.reason,
      scope: input.scope,
    },
  };
}

export function createRetryObservation(input: CreateRetryObservationInput): RunObservation {
  return {
    observationId: input.observationId,
    runId: input.runId,
    stepId: input.stepId,
    actionId: input.actionId,
    source: 'checkpoint',
    kind: 'retry_requested',
    summary: `Retry requested: ${input.reason}`,
    receivedAt: input.receivedAt,
    metadata: {
      retryRequestId: input.retryRequestId,
      ...(input.checkpointId ? { checkpointId: input.checkpointId } : {}),
      retryKind: input.retryKind,
      reason: input.reason,
    },
  };
}

export function isRecoveryObservation(observation: RunObservation): boolean {
  return observation.source === 'checkpoint'
    && ['checkpoint_created', 'resume_requested', 'cancel_requested', 'retry_requested'].includes(observation.kind);
}

export function toCheckpointCreatedPayload(
  observation: RunObservation,
): RuntimeEventPayloadByType['checkpoint.created'] {
  const metadata = observation.metadata ?? {};
  return {
    checkpointId: readString(metadata, 'checkpointId'),
    reason: readString(metadata, 'reason') as CheckpointReason,
    boundary: readString(metadata, 'boundary') as CheckpointBoundary,
    stateSummary: readString(metadata, 'stateSummary'),
  };
}

function readString(metadata: Record<string, unknown>, key: string): string {
  const value = metadata[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing recovery observation metadata: ${key}`);
  }
  return value;
}
