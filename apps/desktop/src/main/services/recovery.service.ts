import type { RecoveryRepository } from '@megumi/db';
import type {
  CancelRequest,
  RecoverableRunSummary,
  ResumeRequest,
  RetryRequest,
} from '@megumi/shared/recovery-contracts';
import {
  CancelRequestSchema,
  ResumeRequestSchema,
  RetryRequestSchema,
} from '@megumi/shared/recovery-contracts';
import type {
  WorkspaceRestoreData,
  WorkspaceRestorePayload,
} from '@megumi/shared/ipc-schemas';
import { createRunInterruptedEvent } from '@megumi/shared/runtime-event-factory';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';

export interface RecoveryIds {
  resumeRequestId(): string;
  cancelRequestId(): string;
  retryRequestId(): string;
  eventId(): string;
  interruptedMarkerId(runId: string): string;
}

export interface CreateRecoveryServiceOptions {
  repository: RecoveryRepository;
  clock: () => Date;
  ids: RecoveryIds;
  appendRuntimeEvent?: (event: RuntimeEvent) => void;
  nextRuntimeSequence?: (runId: string) => number;
}

export interface RecoveryService {
  listRecoverableRuns(): RecoverableRunSummary[];
  resumeRun(payload: Omit<ResumeRequest, 'resumeRequestId' | 'createdAt'>): ResumeRequest;
  cancelRun(payload: Omit<CancelRequest, 'cancelRequestId' | 'createdAt'>): CancelRequest;
  retryRun(payload: Omit<RetryRequest, 'retryRequestId' | 'createdAt'>): RetryRequest;
  restoreWorkspaceChangeSet(payload: WorkspaceRestorePayload): Promise<WorkspaceRestoreData>;
}

export function createRecoveryService(options: CreateRecoveryServiceOptions): RecoveryService {
  const interruptedMarkers = options.repository.markInterruptedRuns({
    markedAt: options.clock().toISOString(),
    reason: 'app_restarted',
    createMarkerId: options.ids.interruptedMarkerId,
  });

  for (const marker of interruptedMarkers) {
    options.appendRuntimeEvent?.(createRunInterruptedEvent({
      eventId: options.ids.eventId(),
      runId: marker.runId,
      sessionId: marker.sessionId,
      sequence: options.nextRuntimeSequence?.(marker.runId) ?? 1,
      createdAt: marker.markedAt,
      payload: {
        interruptedMarkerId: marker.interruptedMarkerId,
        previousStatus: marker.previousStatus,
        reason: marker.reason,
      },
    }));
  }

  return {
    listRecoverableRuns: () => options.repository.listRecoverableRuns(),
    resumeRun: (payload) => {
      const request = ResumeRequestSchema.parse({
        ...payload,
        resumeRequestId: options.ids.resumeRequestId(),
        createdAt: options.clock().toISOString(),
      });
      return options.repository.saveResumeRequest(request);
    },
    cancelRun: (payload) => {
      const request = CancelRequestSchema.parse({
        ...payload,
        cancelRequestId: options.ids.cancelRequestId(),
        createdAt: options.clock().toISOString(),
      });
      return options.repository.saveCancelRequest(request);
    },
    retryRun: (payload) => {
      const request = RetryRequestSchema.parse({
        ...payload,
        retryRequestId: options.ids.retryRequestId(),
        createdAt: options.clock().toISOString(),
      });
      return options.repository.saveRetryRequest(request);
    },
    restoreWorkspaceChangeSet: async () => {
      throw new Error('Workspace restore service is not configured.');
    },
  };
}
