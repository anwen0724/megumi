import type { RecoveryRepository } from '@megumi/coding-agent/persistence';
import type { RunNeedingTimelineBackfill } from '@megumi/coding-agent/persistence';
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
import { ChatStreamEventSchema, type ChatStreamEvent } from '@megumi/shared/chat-stream';
import { reduceChatStreamEvent, type TimelineMessage } from '@megumi/shared/timeline';

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

// Commits a backfilled failure/cancellation timeline message for terminal runs that
// never committed any history (legacy orphans, interrupted-on-restart). Supplied by
// composition; omitted in tests/entries that don't need backfill.
export interface RecoveryTimelineBackfillPort {
  listRunsNeedingTimelineBackfill(): RunNeedingTimelineBackfill[];
  hasCommittedTimeline(runId: string): boolean;
  commitRunTimeline(input: {
    projectId: string;
    sessionId: string;
    runId: string;
    committedAt: string;
    messages: TimelineMessage[];
  }): unknown;
}

export interface RecoveryLogger {
  warn(message: string, metadata?: Record<string, unknown>): void;
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
  timelineBackfill?: RecoveryTimelineBackfillPort;
  logger?: RecoveryLogger;
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

  if (options.timelineBackfill) {
    backfillTerminalRunTimelines(options.timelineBackfill, options.logger);
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

// Commits a backfilled failure/cancellation timeline message for each terminal run
// that never committed history, so it renders inline in the timeline instead of as
// an anchorless recovery action. Idempotent (skips runs that already committed) and
// best-effort (a single failure is logged, never aborts startup).
function backfillTerminalRunTimelines(
  backfill: RecoveryTimelineBackfillPort,
  logger?: RecoveryLogger,
): void {
  for (const run of backfill.listRunsNeedingTimelineBackfill()) {
    try {
      if (backfill.hasCommittedTimeline(run.runId)) {
        continue;
      }
      const committedAt = run.completedAt ?? run.createdAt;
      const events = createBackfillEvents(run, committedAt);
      const messages = events.reduce<TimelineMessage[]>(
        (acc, event) => reduceChatStreamEvent(acc, event),
        [],
      );
      backfill.commitRunTimeline({
        projectId: run.projectId,
        sessionId: run.sessionId,
        runId: run.runId,
        committedAt,
        messages,
      });
    } catch (error) {
      logger?.warn('recovery_timeline_backfill_failed', {
        runId: run.runId,
        reason: run.reason,
        message: error instanceof Error ? error.message : 'Unknown error.',
      });
    }
  }
}

// Builds the chat-stream events that reduce into the backfilled timeline: the
// triggering user prompt (when known) followed by the terminal failure/cancellation,
// mirroring a normal turn's user + assistant pair.
function createBackfillEvents(
  run: RunNeedingTimelineBackfill,
  committedAt: string,
): ChatStreamEvent[] {
  const streamId = `chat-stream:${run.runId}:recovery-backfill`;
  const events: ChatStreamEvent[] = [];

  if (run.triggerMessageId && run.triggerMessageContent !== null) {
    events.push(ChatStreamEventSchema.parse({
      eventId: `recovery-backfill:${run.runId}:user`,
      projectId: run.projectId,
      sessionId: run.sessionId,
      runId: run.runId,
      streamId,
      streamKind: 'main',
      seq: 1,
      createdAt: run.triggerMessageCreatedAt ?? run.createdAt,
      eventType: 'user.message.committed',
      clientMessageId: run.triggerMessageId,
      messageId: run.triggerMessageId,
      text: run.triggerMessageContent,
    }));
  }

  events.push(createBackfillTerminalEvent(run, committedAt, streamId, events.length + 1));
  return events;
}

function createBackfillTerminalEvent(
  run: RunNeedingTimelineBackfill,
  committedAt: string,
  streamId: string,
  seq: number,
): ChatStreamEvent {
  const base = {
    eventId: `recovery-backfill:${run.runId}`,
    projectId: run.projectId,
    sessionId: run.sessionId,
    runId: run.runId,
    // streamId must differ from runId per ChatStreamEvent schema.
    streamId,
    streamKind: 'main' as const,
    seq,
    createdAt: committedAt,
  };

  if (run.reason === 'cancelled') {
    return ChatStreamEventSchema.parse({ ...base, eventType: 'turn.cancelled' });
  }

  const runtimeError = parseRuntimeErrorJson(run.errorJson);
  return ChatStreamEventSchema.parse({
    ...base,
    eventType: 'turn.failed',
    ...(runtimeError?.code ? { errorCode: runtimeError.code } : {}),
    errorMessage: runtimeError?.message
      ?? (run.reason === 'interrupted'
        ? '上次这条请求未完成，可重试或忽略。'
        : 'This request failed.'),
    recoverable: true,
  });
}

function parseRuntimeErrorJson(errorJson: string | null): { code?: string; message?: string } | undefined {
  if (!errorJson) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(errorJson) as unknown;
    if (parsed && typeof parsed === 'object') {
      const record = parsed as { code?: unknown; message?: unknown };
      return {
        ...(typeof record.code === 'string' ? { code: record.code } : {}),
        ...(typeof record.message === 'string' ? { message: record.message } : {}),
      };
    }
  } catch {
    // Malformed error_json — fall through to a generic message.
  }
  return undefined;
}

