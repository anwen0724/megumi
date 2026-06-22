import type { RecoveryRepository } from '@megumi/coding-agent/persistence';
import type {
  CancelRequest,
  RecoverableRunSummary,
  ResumeRequest,
  RetryRequest,
} from '@megumi/shared/recovery';
import {
  CancelRequestSchema,
  ResumeRequestSchema,
  RetryRequestSchema,
} from '@megumi/shared/recovery';
import type {
  WorkspaceRestoreData,
  WorkspaceRestorePayload,
} from '@megumi/shared/ipc';
import {
  createRunInterruptedEvent,
  createWorkspaceRestoreCompletedEvent,
  createWorkspaceRestoreRequestedEvent,
} from '@megumi/shared/runtime';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import type { WorkspaceChangeSummary } from '@megumi/shared/workspace';

export interface RecoveryIds {
  resumeRequestId(): string;
  cancelRequestId(): string;
  retryRequestId(): string;
  eventId(): string;
  interruptedMarkerId(runId: string): string;
}

export interface WorkspaceChangeSummaryPort {
  listChangeSummariesByRun(runId: string): WorkspaceChangeSummary[];
}

export interface WorkspaceRestorePort {
  restoreChangeSet(input: WorkspaceRestorePayload): Promise<WorkspaceRestoreData>;
}

export interface CreateRecoveryServiceOptions {
  repository: RecoveryRepository;
  clock: () => Date;
  ids: RecoveryIds;
  appendRuntimeEvent?: (event: RuntimeEvent) => void;
  nextRuntimeSequence?: (runId: string) => number;
  publishWorkspaceChangeFooter?: (runId: string, createdAt: string) => void;
  workspaceChanges?: WorkspaceChangeSummaryPort;
  workspaceRestore: WorkspaceRestorePort;
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
    listRecoverableRuns: () => options.repository.listRecoverableRuns().map((run) => {
      const workspaceChangeSummaries = options.workspaceChanges
        ?.listChangeSummariesByRun(run.runId)
        .filter((summary) => summary.changedFileCount > 0);
      return {
        ...run,
        ...(workspaceChangeSummaries?.length ? { workspaceChangeSummaries } : {}),
      };
    }),
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
    restoreWorkspaceChangeSet: async (payload) => {
      const restored = await options.workspaceRestore.restoreChangeSet(payload);
      const createdAt = options.clock().toISOString();
      const sequence = options.nextRuntimeSequence?.(restored.result.runId) ?? 1;

      options.appendRuntimeEvent?.(createWorkspaceRestoreRequestedEvent({
        eventId: options.ids.eventId(),
        runId: restored.result.runId,
        sessionId: restored.result.sessionId,
        requestId: restored.request.restoreRequestId,
        sequence,
        createdAt,
        source: 'main',
        payload: {
          restoreRequestId: restored.request.restoreRequestId,
          changeSetId: restored.request.changeSetId,
          requestedBy: restored.request.requestedBy,
        },
      }));

      options.appendRuntimeEvent?.(createWorkspaceRestoreCompletedEvent({
        eventId: options.ids.eventId(),
        runId: restored.result.runId,
        sessionId: restored.result.sessionId,
        requestId: restored.request.restoreRequestId,
        sequence: sequence + 1,
        createdAt,
        source: 'main',
        payload: {
          restoreRequestId: restored.request.restoreRequestId,
          restoreResultId: restored.result.restoreResultId,
          changeSetId: restored.result.changeSetId,
          status: restored.result.status,
          changedFileCount: numberMetadata(restored.result.metadata, 'changedFileCount'),
          restoredCount: numberMetadata(restored.result.metadata, 'restoredCount'),
          conflictCount: numberMetadata(restored.result.metadata, 'conflictCount'),
          failedCount: numberMetadata(restored.result.metadata, 'failedCount'),
          noopCount: numberMetadata(restored.result.metadata, 'noopCount'),
        },
      }));

      options.publishWorkspaceChangeFooter?.(restored.result.runId, createdAt);

      return restored;
    },
  };
}

function numberMetadata(metadata: WorkspaceRestoreData['result']['metadata'], key: string): number {
  const value = metadata?.[key];
  return typeof value === 'number' ? value : 0;
}

