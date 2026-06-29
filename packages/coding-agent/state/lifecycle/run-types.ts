import type {
  RunAction,
  RunObservation,
  Run,
  RunStep,
  SessionMessage,
} from '@megumi/shared/session';
import type {
  RunContext,
  ContextPatch,
} from '@megumi/shared/run';
import type { PermissionModeState } from '@megumi/shared/permission';
import { createRuntimeDebugId } from '@megumi/shared/runtime';
import type { RuntimeContext, RuntimeError, RuntimeEvent } from '@megumi/shared/runtime';

export interface RunClock {
  now(): string;
}

export interface RunIdFactory {
  runId(): string;
  stepId(): string;
  actionId(): string;
  observationId(): string;
  checkpointId(): string;
  resumeRequestId(): string;
  cancelRequestId(): string;
  retryRequestId(): string;
  eventId(): string;
  messageId(): string;
  debugId(): string;
}

export interface RunLifecycleSink {
  saveRun(run: Run): void | Promise<void>;
  saveStep(step: RunStep): void | Promise<void>;
  saveAction(action: RunAction): void | Promise<void>;
  saveObservation(observation: RunObservation): void | Promise<void>;
  saveMessage?(message: SessionMessage): void | Promise<void>;
  appendEvent(event: RuntimeEvent): void | Promise<void>;
}

export interface RunHostBoundaryPort {
  handleAction(action: RunAction): Promise<RunObservation> | RunObservation;
}

export interface CancelRunInput {
  runId: string;
  reason?: string;
}

export interface CancelRunPort {
  cancelRun(input: CancelRunInput): boolean;
}

export interface RunRetryInput {
  runId: string;
  retryKind: 'manual_retry' | 'manual_rerun';
  reason?: string;
  requestedAt: string;
}

export interface RunFailureInput {
  runId: string;
  stepId?: string;
  error: RuntimeError;
  failedAt: string;
}

export interface RunTurnInput {
  sessionId: string;
  triggerMessageId?: string;
  permissionMode?: string;
  permissionModeState?: PermissionModeState;
  permissionSnapshotRef?: string;
  sourcePlanId?: string;
  goal: string;
  actionKind?: RunAction['kind'];
  actionInput?: RunAction['inputPreview'];
  actionInputPreview?: RunAction['inputPreview'];
  initialContext?: RunContext;
  contextPatch?: ContextPatch;
  lifecycle: RunLifecycleSink;
  hostBoundary: RunHostBoundaryPort;
  clock?: RunClock;
  ids?: Partial<RunIdFactory>;
}

export interface StartAgentLoopRunInput {
  runId: string;
  stepId: string;
  sessionId: string;
  triggerMessageId: string;
  mode: string;
  goal: string;
  permissionSnapshotRef?: string;
  createdAt: string;
  lifecycle: Pick<RunLifecycleSink, 'saveRun' | 'saveStep'>;
}

export interface StartAgentLoopRunResult {
  run: Run;
  step: RunStep;
}

export interface AttachRunPermissionSnapshotInput {
  run: Run;
  permissionSnapshotRef: string;
  lifecycle: Pick<RunLifecycleSink, 'saveRun'>;
}

export interface FailAgentLoopBeforeModelStepInput {
  requestId: string;
  runtimeContext?: RuntimeContext;
  sessionId: string;
  run: Run;
  step: RunStep;
  error: RuntimeError;
  startSequence: number;
  failedAt: string;
  ids: Pick<RunIdFactory, 'eventId'>;
  lifecycle: Pick<RunLifecycleSink, 'saveRun' | 'saveStep'>;
}

export interface FailAgentLoopBeforeModelStepResult {
  run: Run;
  step: RunStep;
  events: RuntimeEvent[];
}

export interface RunTurnResult {
  run: Run;
  step: RunStep;
  action: RunAction;
  observation: RunObservation;
  observations: RunObservation[];
  events: RuntimeEvent[];
  context?: RunContext;
}

export const defaultRunClock: RunClock = {
  now: () => new Date().toISOString(),
};

export function createDefaultRunIds(): RunIdFactory {
  return {
    runId: () => `run:${crypto.randomUUID()}`,
    stepId: () => `step:${crypto.randomUUID()}`,
    actionId: () => `action:${crypto.randomUUID()}`,
    observationId: () => `observation:${crypto.randomUUID()}`,
    checkpointId: () => `checkpoint:${crypto.randomUUID()}`,
    resumeRequestId: () => `resume-request:${crypto.randomUUID()}`,
    cancelRequestId: () => `cancel-request:${crypto.randomUUID()}`,
    retryRequestId: () => `retry-request:${crypto.randomUUID()}`,
    eventId: () => `event:${crypto.randomUUID()}`,
    messageId: () => `message:${crypto.randomUUID()}`,
    debugId: createRuntimeDebugId,
  };
}
