// Restores run lifecycle state when all pending approval gates are resolved.
import type { ModelStepRuntimeRequest } from '@megumi/shared/model';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import type { Run } from '@megumi/shared/session';
import { createRunStatusChangedEvent, withRequestMetadata } from '../events';
import { assertRunStatusTransition } from './run-state-policy';

export interface RunApprovalResumeRepositoryPort {
  getRun(runId: string): Run | undefined;
  saveRun(run: Run): Run;
}

export interface RunApprovalResumeIds {
  eventId(): string;
}

export function resumeRunAfterApproval(input: {
  request: ModelStepRuntimeRequest;
  fallbackRun: Run;
  repository: RunApprovalResumeRepositoryPort;
  ids: RunApprovalResumeIds;
  decidedAt: string;
  lastSequence: number;
}): {
  run: Run;
  event: RuntimeEvent;
  lastSequence: number;
} {
  const persistedRun = input.repository.getRun(input.request.runId) ?? input.fallbackRun;
  assertRunStatusTransition(persistedRun.status, 'running');
  const run = input.repository.saveRun({
    ...persistedRun,
    status: 'running',
  });
  const lastSequence = input.lastSequence + 1;

  return {
    run,
    lastSequence,
    event: withRequestMetadata(createRunStatusChangedEvent({
      eventId: input.ids.eventId(),
      sessionId: input.request.sessionId,
      runId: input.request.runId,
      sequence: lastSequence,
      createdAt: input.decidedAt,
      from: 'waiting_for_approval',
      to: 'running',
    }), input.request),
  };
}
