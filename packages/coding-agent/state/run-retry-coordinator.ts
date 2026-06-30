// Owns manual retry and rerun lifecycle records for Coding Agent runs.
import type { ModelInputContextSourceRef } from '@megumi/shared/model';
import type { JsonObject } from '@megumi/shared/primitives';
import {
  createRuntimeEvent,
  type RuntimeContext,
  type RuntimeEvent,
} from '@megumi/shared/runtime';
import type {
  Run,
  SessionActiveLeaf,
  SessionBranchMarker,
  SessionMessage,
  SessionRetryAttempt,
  SessionSourceEntry,
} from '@megumi/shared/session';

import type { SessionBranchServicePort } from '../session';
import { RuntimeEventLog } from '../events';

export interface RunRetryCoordinatorIds {
  eventId(): string;
  retryAttemptId(): string;
  sourceEntryId(): string;
}

export interface RunRetryCoordinatorRepositoryPort {
  getRun(runId: string): Run | undefined;
  getMessage(messageId: string): SessionMessage | undefined;
  listRuntimeEventsByRun(runId: string): RuntimeEvent[];
  appendRuntimeEvent(event: RuntimeEvent): RuntimeEvent;
}

export interface RunRetryActivePathRepositoryPort {
  getActiveLeaf(sessionId: string): SessionActiveLeaf | undefined;
  getSourceEntryBySourceRef(
    sessionId: string,
    sourceRef: ModelInputContextSourceRef,
  ): SessionSourceEntry | undefined;
  appendSourceEntryAndSetActiveLeaf(
    entry: SessionSourceEntry,
    activeLeaf: SessionActiveLeaf,
  ): SessionSourceEntry;
  listRetryAttemptsByRun(runId: string): SessionRetryAttempt[];
  saveRetryAttempt(attempt: SessionRetryAttempt): SessionRetryAttempt;
}

export interface RunRetryCoordinatorOptions {
  repository: RunRetryCoordinatorRepositoryPort;
  activePathRepository?: RunRetryActivePathRepositoryPort;
  sessionBranchService?: SessionBranchServicePort;
  ids: RunRetryCoordinatorIds;
}

export interface CreateManualRetryFromRunInput {
  requestId: string;
  runId: string;
  createdAt: string;
  runtimeContext?: RuntimeContext;
}

export interface CreateManualRetryFromRunResult {
  retryAttempt: SessionRetryAttempt;
  retryAttemptSourceEntry: SessionSourceEntry;
  events: RuntimeEvent[];
}

export interface CreateManualRerunFromUserMessageInput {
  requestId: string;
  sessionId: string;
  messageId: string;
  createdAt: string;
  runtimeContext?: RuntimeContext;
}

export interface CreateManualRerunFromUserMessageResult {
  branchMarker: SessionBranchMarker;
  branchMarkerSourceEntry: SessionSourceEntry;
  seedMessage: SessionMessage;
  retryAttempt: SessionRetryAttempt;
  retryAttemptSourceEntry: SessionSourceEntry;
  events: RuntimeEvent[];
}

export interface RecordManualRerunAttemptForBranchDraftInput {
  requestId: string;
  sessionId: string;
  runId: string;
  branchMarkerId: string;
  marker: SessionBranchMarker;
  createdAt: string;
  runtimeContext?: RuntimeContext;
}

export interface RunRetryCoordinatorPort {
  createManualRetryFromRun(input: CreateManualRetryFromRunInput): CreateManualRetryFromRunResult;
  createManualRerunFromUserMessage(input: CreateManualRerunFromUserMessageInput): CreateManualRerunFromUserMessageResult;
  recordManualRerunAttemptForBranchDraft(input: RecordManualRerunAttemptForBranchDraftInput): RuntimeEvent;
}

export class RunRetryCoordinator {
  private readonly repository: RunRetryCoordinatorOptions['repository'];
  private readonly eventLog: RuntimeEventLog;
  private readonly activePathRepository?: RunRetryCoordinatorOptions['activePathRepository'];
  private readonly sessionBranchService?: SessionBranchServicePort;
  private readonly ids: RunRetryCoordinatorIds;

  constructor(options: RunRetryCoordinatorOptions) {
    this.repository = options.repository;
    this.eventLog = new RuntimeEventLog(options.repository);
    this.activePathRepository = options.activePathRepository;
    this.sessionBranchService = options.sessionBranchService;
    this.ids = options.ids;
  }

  createManualRetryFromRun(input: CreateManualRetryFromRunInput): CreateManualRetryFromRunResult {
    const activePathRepository = this.requireActivePathRepository();
    const run = this.repository.getRun(input.runId);
    if (!run || !['failed', 'cancelled', 'cancelling', 'running', 'queued'].includes(run.status)) {
      throw new Error('Manual retry requires a failed, cancelled, interrupted, or running-like run.');
    }

    const runSourceEntry = activePathRepository.getSourceEntryBySourceRef(run.sessionId, {
      sourceKind: 'session_run',
      sourceId: String(run.runId),
    });
    const retryAttemptId = this.ids.retryAttemptId();
    const retryAttempt = activePathRepository.saveRetryAttempt({
      retryAttemptId,
      sessionId: run.sessionId,
      runId: String(run.runId),
      baseRunId: String(run.runId),
      ...(runSourceEntry ? { baseSourceEntryId: runSourceEntry.sourceEntryId } : {}),
      attemptNumber: activePathRepository.listRetryAttemptsByRun(String(run.runId)).length + 1,
      retryKind: 'manual_retry',
      reason: manualRetryReasonForRunStatus(run.status),
      status: 'pending',
      retryable: true,
      createdAt: input.createdAt,
      metadata: {
        requestId: input.requestId,
        previousStatus: run.status,
        ...(run.error?.message ? { previousErrorMessage: run.error.message } : {}),
      },
    });
    const retryAttemptSourceEntry = this.appendSourceAndMoveLeaf({
      sessionId: run.sessionId,
      sourceRef: retryAttemptSourceRef(retryAttempt.retryAttemptId, input.createdAt),
      createdAt: input.createdAt,
      metadata: {
        requestId: input.requestId,
        baseRunId: String(run.runId),
      },
    });

    const sequence = this.eventLog.createSequenceCursor({ runId: String(run.runId) });
    const events = [
      createRuntimeEvent({
        eventId: this.ids.eventId(),
        eventType: 'run.retry.requested',
        runId: String(run.runId),
        sessionId: run.sessionId,
        requestId: input.requestId,
        ...(input.runtimeContext ? { context: input.runtimeContext } : {}),
        sequence: sequence.next(),
        createdAt: input.createdAt,
        source: 'main',
        visibility: 'system',
        persist: 'required',
        payload: {
          retryRequestId: retryAttempt.retryAttemptId,
          requestedBy: 'user',
          retryKind: 'manual_retry',
          reason: retryAttempt.reason,
        },
      }),
      createRuntimeEvent({
        eventId: this.ids.eventId(),
        eventType: 'retry.started',
        runId: String(run.runId),
        sessionId: run.sessionId,
        requestId: input.requestId,
        ...(input.runtimeContext ? { context: input.runtimeContext } : {}),
        sequence: sequence.next(),
        createdAt: input.createdAt,
        source: 'main',
        visibility: 'system',
        persist: 'required',
        payload: {
          retryRequestId: retryAttempt.retryAttemptId,
          retryKind: 'manual_retry',
        },
      }),
    ];
    for (const event of events) {
      this.eventLog.append(event);
    }

    return { retryAttempt, retryAttemptSourceEntry, events };
  }

  createManualRerunFromUserMessage(input: CreateManualRerunFromUserMessageInput): CreateManualRerunFromUserMessageResult {
    const branch = this.requireSessionBranchService().createBranchFromUserMessage(input);
    const retryAttemptId = this.ids.retryAttemptId();
    const retryAttempt = this.requireActivePathRepository().saveRetryAttempt({
      retryAttemptId,
      sessionId: input.sessionId,
      runId: String(branch.seedMessage.runId),
      baseSourceEntryId: branch.branchMarkerSourceEntry.sourceEntryId,
      attemptNumber: 1,
      retryKind: 'manual_rerun',
      reason: 'user_requested',
      status: 'pending',
      retryable: true,
      createdAt: input.createdAt,
      metadata: {
        requestId: input.requestId,
        seedMessageId: input.messageId,
        branchMarkerId: branch.branchMarker.branchMarkerId,
      },
    });
    const retryAttemptSourceEntry = this.appendSourceAndMoveLeaf({
      sessionId: input.sessionId,
      sourceRef: retryAttemptSourceRef(retryAttempt.retryAttemptId, input.createdAt),
      createdAt: input.createdAt,
      metadata: {
        requestId: input.requestId,
        branchMarkerId: branch.branchMarker.branchMarkerId,
      },
    });

    return {
      ...branch,
      retryAttempt,
      retryAttemptSourceEntry,
      events: branch.events,
    };
  }

  recordManualRerunAttemptForBranchDraft(input: RecordManualRerunAttemptForBranchDraftInput): RuntimeEvent {
    const activePathRepository = this.requireActivePathRepository();
    const marker = input.marker;

    const seedRunId = marker.seedSourceRef?.sourceKind === 'session_message'
      ? this.repository.getMessage(marker.seedSourceRef.sourceId)?.runId
      : undefined;
    const runId = String(seedRunId ?? input.runId);
    const retryAttemptId = this.ids.retryAttemptId();
    const retryAttempt = activePathRepository.saveRetryAttempt({
      retryAttemptId,
      sessionId: input.sessionId,
      runId,
      ...(marker.targetLeafSourceEntryId ? { baseSourceEntryId: marker.targetLeafSourceEntryId } : {}),
      attemptNumber: activePathRepository.listRetryAttemptsByRun(runId).length + 1,
      retryKind: 'manual_rerun',
      reason: 'user_requested',
      status: 'pending',
      retryable: true,
      createdAt: input.createdAt,
      metadata: {
        requestId: input.requestId,
        branchMarkerId: input.branchMarkerId,
      },
    });

    return createRuntimeEvent({
      eventId: this.ids.eventId(),
      eventType: 'run.retry.requested',
      runId,
      sessionId: input.sessionId,
      requestId: input.requestId,
      ...(input.runtimeContext ? { context: input.runtimeContext } : {}),
      sequence: this.eventLog.nextSequenceForRun(runId),
      createdAt: input.createdAt,
      source: 'main',
      visibility: 'system',
      persist: 'required',
      payload: {
        retryRequestId: retryAttempt.retryAttemptId,
        requestedBy: 'user',
        retryKind: 'manual_rerun',
        reason: 'user_requested',
        attemptNumber: retryAttempt.attemptNumber,
      },
    });
  }

  private appendSourceAndMoveLeaf(input: {
    sessionId: string;
    sourceRef: ModelInputContextSourceRef;
    createdAt: string;
    reason?: 'source_appended' | 'branch_marker';
    metadata?: JsonObject;
  }): SessionSourceEntry {
    const activePathRepository = this.requireActivePathRepository();
    const parentSourceEntryId = activePathRepository.getActiveLeaf(input.sessionId)?.leafSourceEntryId ?? undefined;
    const sourceEntryId = this.ids.sourceEntryId();
    return activePathRepository.appendSourceEntryAndSetActiveLeaf({
      sourceEntryId,
      sessionId: input.sessionId,
      ...(parentSourceEntryId ? { parentSourceEntryId } : {}),
      sourceRef: input.sourceRef,
      createdAt: input.createdAt,
      ...(input.metadata ? { metadata: input.metadata } : {}),
    }, {
      sessionId: input.sessionId,
      leafSourceEntryId: sourceEntryId,
      updatedAt: input.createdAt,
      reason: input.reason ?? 'source_appended',
      ...(input.metadata ? { metadata: input.metadata } : {}),
    });
  }

  private requireActivePathRepository(): NonNullable<RunRetryCoordinatorOptions['activePathRepository']> {
    if (!this.activePathRepository) {
      throw new Error('Manual retry/rerun requires active path repository.');
    }
    return this.activePathRepository;
  }

  private requireSessionBranchService(): SessionBranchServicePort {
    if (!this.sessionBranchService) {
      throw new Error('Manual rerun requires session branch service.');
    }
    return this.sessionBranchService;
  }
}

function retryAttemptSourceRef(retryAttemptId: string, builtAt: string): ModelInputContextSourceRef {
  return {
    sourceKind: 'retry_attempt',
    sourceId: retryAttemptId,
    sourceUri: `retry-attempt://${retryAttemptId}`,
    loadedAt: builtAt,
  };
}

function manualRetryReasonForRunStatus(status: Run['status']): SessionRetryAttempt['reason'] {
  if (status === 'failed') {
    return 'failed';
  }
  if (['cancelled', 'cancelling'].includes(status)) {
    return 'cancelled';
  }
  return 'interrupted';
}
