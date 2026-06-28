import type { RunObservation } from '@megumi/shared/session';
import type {
  ContextPatch,
  ContextPatchAppliedPayload,
  ContextPatchRejectedPayload,
  ContextPatchRequestedPayload,
} from '@megumi/shared/run';
import type { JsonObject } from '@megumi/shared/primitives';

export function createContextUpdateInputPreview(patch: ContextPatch): ContextPatchRequestedPayload {
  return {
    patchId: patch.patchId,
    operation: patch.operation,
    requestedBy: patch.requestedBy,
    reason: patch.reason,
  };
}

export function createContextPatchObservation(input: {
  observationId: string;
  patch: ContextPatch;
  receivedAt: string;
  effectiveContextBuildId?: string;
  rejectionReason?: string;
}): RunObservation {
  const isRejected = input.patch.status === 'rejected' || Boolean(input.rejectionReason);
  const metadata: JsonObject = {
    patchId: input.patch.patchId,
    operation: input.patch.operation,
    requestedBy: input.patch.requestedBy,
    ...(input.effectiveContextBuildId ? { effectiveContextBuildId: input.effectiveContextBuildId } : {}),
    ...(input.rejectionReason ? { rejectionReason: input.rejectionReason } : {}),
  };

  return {
    observationId: input.observationId,
    runId: input.patch.runId,
    ...(input.patch.stepId ? { stepId: input.patch.stepId } : {}),
    source: 'workspace',
    kind: isRejected ? 'context_patch_rejected' : 'context_patch_applied',
    receivedAt: input.receivedAt,
    summary: isRejected
      ? `Context patch ${input.patch.operation} rejected.`
      : `Context patch ${input.patch.operation} applied.`,
    metadata,
  };
}

export function isContextPatchObservation(observation: RunObservation): boolean {
  return observation.kind === 'context_patch_applied' || observation.kind === 'context_patch_rejected';
}

export function toContextPatchAppliedPayload(observation: RunObservation): ContextPatchAppliedPayload | undefined {
  if (observation.kind !== 'context_patch_applied') {
    return undefined;
  }

  const metadata = observation.metadata ?? {};
  const patchId = metadata.patchId;
  const operation = metadata.operation;

  if (typeof patchId !== 'string' || typeof operation !== 'string') {
    return undefined;
  }

  return {
    patchId,
    operation: operation as ContextPatchAppliedPayload['operation'],
    ...(typeof metadata.effectiveContextBuildId === 'string'
      ? { effectiveContextBuildId: metadata.effectiveContextBuildId }
      : {}),
  };
}

export function toContextPatchRejectedPayload(observation: RunObservation): ContextPatchRejectedPayload | undefined {
  if (observation.kind !== 'context_patch_rejected') {
    return undefined;
  }

  const metadata = observation.metadata ?? {};
  const patchId = metadata.patchId;
  const operation = metadata.operation;
  const rejectionReason = metadata.rejectionReason ?? observation.summary;

  if (typeof patchId !== 'string' || typeof operation !== 'string' || typeof rejectionReason !== 'string') {
    return undefined;
  }

  return {
    patchId,
    operation: operation as ContextPatchRejectedPayload['operation'],
    rejectionReason,
  };
}

