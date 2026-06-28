import { describe, expect, it } from 'vitest';
import type { ModelInputContextSourceRef } from '@megumi/shared/model';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import type {
  Run,
  SessionActiveLeaf,
  SessionBranchMarker,
  SessionMessage,
  SessionRetryAttempt,
  SessionSourceEntry,
} from '@megumi/shared/session';

import {
  RunRetryCoordinator,
  type RunRetryCoordinatorOptions,
} from '@megumi/coding-agent/state';

describe('RunRetryCoordinator', () => {
  it('creates a manual retry attempt without mutating the original failed run', () => {
    const fixture = createFixture();
    fixture.runs.set('run-failed', {
      runId: 'run-failed',
      sessionId: 'session-1',
      status: 'failed',
      goal: 'original goal',
      createdAt: '2026-06-01T10:00:00.000Z',
      error: { message: 'model failed' },
    } as Run);
    fixture.activePath.appendSourceEntryAndSetActiveLeaf(sourceEntry({
      sourceEntryId: 'source-entry-run-failed',
      sourceRef: {
        sourceKind: 'session_run',
        sourceId: 'run-failed',
        sourceUri: 'session-run://run-failed',
      },
    }), {
      sessionId: 'session-1',
      leafSourceEntryId: 'source-entry-run-failed',
      updatedAt: '2026-06-01T10:00:00.000Z',
      reason: 'source_appended',
    });

    const result = fixture.coordinator.createManualRetryFromRun({
      requestId: 'retry-request-1',
      runId: 'run-failed',
      createdAt: '2026-06-01T11:00:00.000Z',
    });

    expect(fixture.runs.get('run-failed')?.status).toBe('failed');
    expect(result.retryAttempt).toMatchObject({
      retryAttemptId: 'retry-attempt-1',
      retryKind: 'manual_retry',
      reason: 'failed',
      baseRunId: 'run-failed',
      baseSourceEntryId: 'source-entry-run-failed',
      status: 'pending',
      retryable: true,
    });
    expect(fixture.activePath.getActiveLeaf('session-1')?.leafSourceEntryId)
      .toBe(result.retryAttemptSourceEntry.sourceEntryId);
    expect(result.events.map((event) => event.eventType)).toEqual([
      'run.retry.requested',
      'retry.started',
    ]);
    expect(fixture.events.map((event) => event.eventType)).toEqual([
      'run.retry.requested',
      'retry.started',
    ]);
  });

  it('creates a manual rerun from a session branch marker and records a retry attempt', () => {
    const fixture = createFixture();
    const seedMessage = {
      messageId: 'message-user-1',
      sessionId: 'session-1',
      runId: 'run-seed',
      role: 'user',
      content: 'Original prompt',
      status: 'completed',
      createdAt: '2026-06-01T10:00:00.000Z',
      completedAt: '2026-06-01T10:00:00.000Z',
    } as SessionMessage;
    const branchMarker = createBranchMarker();
    const branchMarkerSourceEntry = sourceEntry({
      sourceEntryId: 'source-entry-branch-marker',
      sourceRef: {
        sourceKind: 'branch_marker',
        sourceId: branchMarker.branchMarkerId,
        sourceUri: `branch-marker://${branchMarker.branchMarkerId}`,
      },
    });
    fixture.coordinatorWithBranch({
      assertActiveBranchDraftMarker: (() => {
        throw new Error('not used');
      }) as never,
      createBranchFromUserMessage: () => ({
        branchMarker,
        branchMarkerSourceEntry,
        seedMessage,
        events: [runtimeEvent('session.branch_marker.created')],
      }),
      createBranchDraft: (() => {
        throw new Error('not used');
      }) as never,
      cancelBranchDraft: (() => {
        throw new Error('not used');
      }) as never,
    });

    const result = fixture.coordinator.createManualRerunFromUserMessage({
      requestId: 'rerun-request-1',
      sessionId: 'session-1',
      messageId: 'message-user-1',
      createdAt: '2026-06-01T11:00:00.000Z',
    });

    expect(result.branchMarker).toBe(branchMarker);
    expect(result.seedMessage).toBe(seedMessage);
    expect(result.retryAttempt).toMatchObject({
      retryAttemptId: 'retry-attempt-1',
      retryKind: 'manual_rerun',
      reason: 'user_requested',
      runId: 'run-seed',
      baseSourceEntryId: 'source-entry-branch-marker',
    });
    expect(fixture.activePath.getActiveLeaf('session-1')?.leafSourceEntryId)
      .toBe(result.retryAttemptSourceEntry.sourceEntryId);
  });

  it('records branch draft rerun intent against the seed run with incremented attempt number', () => {
    const fixture = createFixture();
    const marker = createBranchMarker();
    fixture.messages.set('message-user-1', {
      messageId: 'message-user-1',
      sessionId: 'session-1',
      runId: 'run-seed',
      role: 'user',
      content: 'Original prompt',
      status: 'completed',
      createdAt: '2026-06-01T10:00:00.000Z',
      completedAt: '2026-06-01T10:00:00.000Z',
    } as SessionMessage);
    fixture.activePath.saveRetryAttempt({
      retryAttemptId: 'retry-attempt-existing',
      sessionId: 'session-1',
      runId: 'run-seed',
      attemptNumber: 1,
      retryKind: 'manual_rerun',
      reason: 'user_requested',
      status: 'failed',
      retryable: true,
      createdAt: '2026-06-01T10:30:00.000Z',
    });
    fixture.events.push(runtimeEvent('run.started', { runId: 'run-seed', sequence: 7 }));

    const event = fixture.coordinator.recordManualRerunAttemptForBranchDraft({
      requestId: 'request-send-rerun-draft',
      sessionId: 'session-1',
      runId: 'run-new',
      branchMarkerId: marker.branchMarkerId,
      marker,
      createdAt: '2026-06-01T11:00:00.000Z',
    });

    const attempts = fixture.activePath.listRetryAttemptsByRun('run-seed');
    expect(attempts.at(-1)).toMatchObject({
      retryAttemptId: 'retry-attempt-1',
      attemptNumber: 2,
      retryKind: 'manual_rerun',
      reason: 'user_requested',
    });
    expect(event).toMatchObject({
      eventType: 'run.retry.requested',
      runId: 'run-seed',
      sequence: 8,
      payload: {
        retryRequestId: 'retry-attempt-1',
        retryKind: 'manual_rerun',
        attemptNumber: 2,
      },
    });
  });
});

function createFixture() {
  const runs = new Map<string, Run>();
  const messages = new Map<string, SessionMessage>();
  const events: RuntimeEvent[] = [];
  const activePath = new InMemoryActivePath();
  let eventIndex = 0;
  let retryAttemptIndex = 0;
  let sourceEntryIndex = 0;
  const baseOptions: RunRetryCoordinatorOptions = {
    repository: {
      getRun: (runId) => runs.get(runId),
      getMessage: (messageId) => messages.get(messageId),
      listRuntimeEventsByRun: (runId) => events.filter((event) => event.runId === runId),
      appendRuntimeEvent: (event) => {
        events.push(event);
        return event;
      },
    },
    activePathRepository: activePath,
    ids: {
      eventId: () => `event-${++eventIndex}`,
      retryAttemptId: () => `retry-attempt-${++retryAttemptIndex}`,
      sourceEntryId: () => `source-entry-${++sourceEntryIndex}`,
    },
  };
  let coordinator = new RunRetryCoordinator(baseOptions);

  return {
    runs,
    messages,
    events,
    activePath,
    get coordinator() {
      return coordinator;
    },
    coordinatorWithBranch(sessionBranchService: RunRetryCoordinatorOptions['sessionBranchService']) {
      coordinator = new RunRetryCoordinator({
        ...baseOptions,
        ...(sessionBranchService ? { sessionBranchService } : {}),
      });
    },
  };
}

class InMemoryActivePath {
  private readonly sourceEntries = new Map<string, SessionSourceEntry>();
  private readonly retryAttempts = new Map<string, SessionRetryAttempt[]>();
  private activeLeaf?: SessionActiveLeaf;

  getActiveLeaf(sessionId: string): SessionActiveLeaf | undefined {
    return this.activeLeaf?.sessionId === sessionId ? this.activeLeaf : undefined;
  }

  getSourceEntryBySourceRef(
    sessionId: string,
    sourceRef: Pick<ModelInputContextSourceRef, 'sourceKind' | 'sourceId'>,
  ): SessionSourceEntry | undefined {
    return Array.from(this.sourceEntries.values()).find((entry) =>
      entry.sessionId === sessionId
      && entry.sourceRef.sourceKind === sourceRef.sourceKind
      && entry.sourceRef.sourceId === sourceRef.sourceId);
  }

  appendSourceEntryAndSetActiveLeaf(
    entry: SessionSourceEntry,
    activeLeaf: SessionActiveLeaf,
  ): SessionSourceEntry {
    this.sourceEntries.set(entry.sourceEntryId, entry);
    this.activeLeaf = activeLeaf;
    return entry;
  }

  listRetryAttemptsByRun(runId: string): SessionRetryAttempt[] {
    return this.retryAttempts.get(runId) ?? [];
  }

  saveRetryAttempt(attempt: SessionRetryAttempt): SessionRetryAttempt {
    const attempts = this.retryAttempts.get(attempt.runId) ?? [];
    attempts.push(attempt);
    this.retryAttempts.set(attempt.runId, attempts);
    return attempt;
  }
}

function sourceEntry(input: {
  sourceEntryId: string;
  sourceRef: ModelInputContextSourceRef;
}): SessionSourceEntry {
  return {
    sourceEntryId: input.sourceEntryId,
    sessionId: 'session-1',
    sourceRef: input.sourceRef,
    createdAt: '2026-06-01T10:00:00.000Z',
  };
}

function createBranchMarker(): SessionBranchMarker {
  return {
    branchMarkerId: 'branch-marker-1',
    sessionId: 'session-1',
    targetLeafSourceEntryId: 'source-entry-message-parent',
    selectedSourceRef: {
      sourceKind: 'session_message',
      sourceId: 'message-user-1',
      sourceUri: 'session-message://message-user-1',
    },
    seedSourceRef: {
      sourceKind: 'session_message',
      sourceId: 'message-user-1',
      sourceUri: 'session-message://message-user-1',
    },
    reason: 'branch_from_user_message',
    createdAt: '2026-06-01T10:30:00.000Z',
  };
}

function runtimeEvent(
  eventType: RuntimeEvent['eventType'],
  overrides: Partial<RuntimeEvent> = {},
): RuntimeEvent {
  return {
    eventId: `event-${eventType}`,
    eventType,
    runId: 'run-1',
    sessionId: 'session-1',
    sequence: 1,
    createdAt: '2026-06-01T10:00:00.000Z',
    source: 'core',
    visibility: 'system',
    persist: 'required',
    payload: {},
    ...overrides,
  } as RuntimeEvent;
}
