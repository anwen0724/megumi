// @vitest-environment node
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { createDatabase } from '@megumi/db/connection';
import { SessionActivePathRepository } from '@megumi/db/repos/session-active-path.repo';
import { SessionRunRepository } from '@megumi/db/repos/session-run.repo';
import { migrateDatabase } from '@megumi/db/schema/migrations';
import type { ModelInputContextSourceRef } from '@megumi/shared/model';
import type {
  SessionRetryAttempt,
  SessionSourceEntry,
} from '@megumi/shared/session';

let db: Database.Database | null = null;

function createRepositories(): {
  activePathRepo: SessionActivePathRepository;
  sessionRunRepo: SessionRunRepository;
  database: Database.Database;
} {
  db = createDatabase(':memory:');
  migrateDatabase(db);
  return {
    activePathRepo: new SessionActivePathRepository(db),
    sessionRunRepo: new SessionRunRepository(db),
    database: db,
  };
}

function seedSession(sessionRunRepo: SessionRunRepository): void {
  sessionRunRepo.saveSession({
    sessionId: 'session-1',
    title: 'Active path',
    status: 'active',
    createdAt: '2026-05-31T12:00:00.000Z',
    updatedAt: '2026-05-31T12:00:00.000Z',
  });
}

function seedSecondSession(sessionRunRepo: SessionRunRepository): void {
  sessionRunRepo.saveSession({
    sessionId: 'session-2',
    title: 'Other active path',
    status: 'active',
    createdAt: '2026-05-31T12:00:00.000Z',
    updatedAt: '2026-05-31T12:00:00.000Z',
  });
}

function sourceRef(
  sourceId: string,
  sourceKind: ModelInputContextSourceRef['sourceKind'],
): ModelInputContextSourceRef {
  return {
    sourceId,
    sourceKind,
    sourceUri: `${sourceKind}://${sourceId}`,
    loadedAt: '2026-05-31T12:00:00.000Z',
  };
}

function sourceEntry(
  sourceEntryId: string,
  sourceId: string,
  sourceKind: ModelInputContextSourceRef['sourceKind'],
  parentSourceEntryId?: string,
  sessionId = 'session-1',
): SessionSourceEntry {
  return {
    sourceEntryId,
    sessionId,
    ...(parentSourceEntryId ? { parentSourceEntryId } : {}),
    sourceRef: sourceRef(sourceId, sourceKind),
    createdAt: '2026-05-31T12:00:00.000Z',
  };
}

function seedRun(sessionRunRepo: SessionRunRepository, runId = 'run-1', sessionId = 'session-1'): void {
  sessionRunRepo.saveRun({
    runId,
    sessionId,
    mode: 'chat',
    goal: 'Answer',
    status: 'running',
    createdAt: '2026-05-31T12:05:00.000Z',
  });
}

function retryAttempt(overrides: Partial<SessionRetryAttempt> = {}): SessionRetryAttempt {
  return {
    retryAttemptId: 'retry-attempt-1',
    sessionId: 'session-1',
    runId: 'run-1',
    baseRunId: 'base-run-1',
    baseSourceEntryId: 'source-entry-1',
    attemptNumber: 1,
    retryKind: 'manual_retry',
    reason: 'failed',
    status: 'running',
    retryable: true,
    createdAt: '2026-05-31T12:05:01.000Z',
    ...overrides,
  };
}

afterEach(() => {
  db?.close();
  db = null;
});

describe('SessionActivePathRepository', () => {
  it('persists source entries and returns the active root-to-leaf path only', () => {
    const { activePathRepo, sessionRunRepo } = createRepositories();
    seedSession(sessionRunRepo);

    const root = activePathRepo.appendSourceEntry(
      sourceEntry('source-entry-1', 'message-1', 'session_message'),
    );
    const activeAssistant = activePathRepo.appendSourceEntry(
      sourceEntry('source-entry-2', 'message-2', 'session_message', root.sourceEntryId),
    );
    const siblingRun = activePathRepo.appendSourceEntry(
      sourceEntry('source-entry-3', 'run-old-branch', 'session_run', root.sourceEntryId),
    );

    activePathRepo.setActiveLeaf({
      sessionId: 'session-1',
      leafSourceEntryId: activeAssistant.sourceEntryId,
      updatedAt: '2026-05-31T12:01:00.000Z',
      reason: 'source_appended',
    });

    expect(activePathRepo.getActiveLeaf('session-1')).toMatchObject({
      leafSourceEntryId: activeAssistant.sourceEntryId,
      reason: 'source_appended',
    });
    expect(activePathRepo.getActivePath('session-1').entries.map((entry) => entry.sourceEntryId)).toEqual([
      root.sourceEntryId,
      activeAssistant.sourceEntryId,
    ]);
    expect(activePathRepo.listActivePathSourceRefs('session-1').map((ref) => ref.sourceId)).toEqual([
      'message-1',
      'message-2',
    ]);
    expect(activePathRepo.getSourceEntryBySourceRef('session-1', siblingRun.sourceRef)?.sourceEntryId).toBe(
      siblingRun.sourceEntryId,
    );
    expect(activePathRepo.findActivePathEntryBySourceRef('session-1', siblingRun.sourceRef)).toBeUndefined();
  });

  it('rejects source entries whose parent source entry belongs to another session', () => {
    const { activePathRepo, sessionRunRepo } = createRepositories();
    seedSession(sessionRunRepo);
    seedSecondSession(sessionRunRepo);

    const otherParent = activePathRepo.appendSourceEntry(
      sourceEntry('source-entry-other-parent', 'message-other-parent', 'session_message', undefined, 'session-2'),
    );

    expect(() => activePathRepo.appendSourceEntry(
      sourceEntry('source-entry-1', 'message-1', 'session_message', otherParent.sourceEntryId),
    )).toThrow(/parentSourceEntryId must belong to session session-1/);
  });

  it('supports empty active leaf without falling back to full session selection', () => {
    const { activePathRepo, sessionRunRepo } = createRepositories();
    seedSession(sessionRunRepo);
    activePathRepo.appendSourceEntry(sourceEntry('source-entry-1', 'message-1', 'session_message'));

    activePathRepo.setActiveLeaf({
      sessionId: 'session-1',
      leafSourceEntryId: null,
      updatedAt: '2026-05-31T12:02:00.000Z',
      reason: 'session_created',
    });

    expect(activePathRepo.getActivePath('session-1')).toEqual({
      sessionId: 'session-1',
      entries: [],
    });
    expect(activePathRepo.listActivePathSourceRefs('session-1')).toEqual([]);
  });

  it('atomically appends a source entry and advances active leaf', () => {
    const { activePathRepo, sessionRunRepo } = createRepositories();
    seedSession(sessionRunRepo);

    const entry = sourceEntry('source-entry-1', 'message-1', 'session_message');
    activePathRepo.appendSourceEntryAndSetActiveLeaf(entry, {
      sessionId: 'session-1',
      leafSourceEntryId: 'source-entry-1',
      updatedAt: '2026-06-01T08:00:00.000Z',
      reason: 'source_appended',
    });

    expect(activePathRepo.getActiveLeaf('session-1')?.leafSourceEntryId).toBe('source-entry-1');
    expect(activePathRepo.getActivePath('session-1').entries.map((item) => item.sourceEntryId)).toEqual([
      'source-entry-1',
    ]);
  });

  it('rolls back source entry append when active leaf update fails', () => {
    const { activePathRepo, sessionRunRepo } = createRepositories();
    seedSession(sessionRunRepo);
    const existingLeaf = activePathRepo.appendSourceEntry(
      sourceEntry('source-entry-existing-leaf', 'message-existing', 'session_message'),
    );
    activePathRepo.setActiveLeaf({
      sessionId: 'session-1',
      leafSourceEntryId: existingLeaf.sourceEntryId,
      updatedAt: '2026-06-01T08:00:00.000Z',
      reason: 'source_appended',
    });

    const newEntry = sourceEntry(
      'source-entry-rolled-back',
      'message-rolled-back',
      'session_message',
      existingLeaf.sourceEntryId,
    );

    expect(() => activePathRepo.appendSourceEntryAndSetActiveLeaf(newEntry, {
      sessionId: 'session-1',
      leafSourceEntryId: 'source-entry-missing',
      updatedAt: '2026-06-01T08:01:00.000Z',
      reason: 'source_appended',
    })).toThrow(/leafSourceEntryId must belong to session session-1/);

    expect(activePathRepo.getSourceEntry(newEntry.sourceEntryId)).toBeUndefined();
    expect(activePathRepo.getActiveLeaf('session-1')?.leafSourceEntryId).toBe(existingLeaf.sourceEntryId);
    expect(activePathRepo.getActivePath('session-1').entries.map((entry) => entry.sourceEntryId)).toEqual([
      existingLeaf.sourceEntryId,
    ]);
  });

  it('gets branch marker by id and lists child source entries', () => {
    const { activePathRepo, sessionRunRepo } = createRepositories();
    seedSession(sessionRunRepo);
    const root = activePathRepo.appendSourceEntry(sourceEntry('source-entry-root', 'message-1', 'session_message'));
    const child = activePathRepo.appendSourceEntry(sourceEntry(
      'source-entry-child',
      'run-1',
      'session_run',
      'source-entry-root',
    ));
    const marker = activePathRepo.recordBranchMarker({
      branchMarkerId: 'branch-marker-1',
      sessionId: 'session-1',
      previousLeafSourceEntryId: child.sourceEntryId,
      targetLeafSourceEntryId: root.sourceEntryId,
      selectedSourceRef: root.sourceRef,
      seedSourceRef: root.sourceRef,
      reason: 'branch_from_user_message',
      createdAt: '2026-06-01T08:00:00.000Z',
    });

    expect(activePathRepo.getBranchMarker(marker.branchMarkerId)?.branchMarkerId).toBe('branch-marker-1');
    expect(activePathRepo.listChildSourceEntries(root.sourceEntryId).map((entry) => entry.sourceEntryId)).toEqual([
      'source-entry-child',
    ]);
  });

  it('rejects active leaves whose source entry belongs to another session', () => {
    const { activePathRepo, sessionRunRepo } = createRepositories();
    seedSession(sessionRunRepo);
    seedSecondSession(sessionRunRepo);
    const otherLeaf = activePathRepo.appendSourceEntry(
      sourceEntry('source-entry-other-leaf', 'message-other-leaf', 'session_message', undefined, 'session-2'),
    );

    expect(() => activePathRepo.setActiveLeaf({
      sessionId: 'session-1',
      leafSourceEntryId: otherLeaf.sourceEntryId,
      updatedAt: '2026-05-31T12:02:01.000Z',
      reason: 'source_appended',
    })).toThrow(/leafSourceEntryId must belong to session session-1/);
  });

  it('persists branch markers and allows active leaf movement to a branch base without mutating old assistant source', () => {
    const { activePathRepo, sessionRunRepo } = createRepositories();
    seedSession(sessionRunRepo);

    const user = activePathRepo.appendSourceEntry(
      sourceEntry('source-entry-1', 'message-user-1', 'session_message'),
    );
    const assistant = activePathRepo.appendSourceEntry(
      sourceEntry('source-entry-2', 'message-assistant-1', 'session_message', user.sourceEntryId),
    );
    activePathRepo.setActiveLeaf({
      sessionId: 'session-1',
      leafSourceEntryId: assistant.sourceEntryId,
      updatedAt: '2026-05-31T12:03:00.000Z',
      reason: 'source_appended',
    });

    activePathRepo.recordBranchMarker({
      branchMarkerId: 'branch-marker-1',
      sessionId: 'session-1',
      previousLeafSourceEntryId: assistant.sourceEntryId,
      targetLeafSourceEntryId: user.sourceEntryId,
      selectedSourceRef: user.sourceRef,
      seedSourceRef: user.sourceRef,
      reason: 'branch_from_user_message',
      createdAt: '2026-05-31T12:04:00.000Z',
      metadata: { actor: 'user' },
    });
    activePathRepo.setActiveLeaf({
      sessionId: 'session-1',
      leafSourceEntryId: user.sourceEntryId,
      updatedAt: '2026-05-31T12:04:01.000Z',
      reason: 'branch_marker',
    });

    expect(activePathRepo.listBranchMarkersBySession('session-1')).toEqual([
      expect.objectContaining({
        branchMarkerId: 'branch-marker-1',
        previousLeafSourceEntryId: assistant.sourceEntryId,
        targetLeafSourceEntryId: user.sourceEntryId,
      }),
    ]);
    expect(activePathRepo.getActivePath('session-1').entries.map((entry) => entry.sourceEntryId)).toEqual([
      user.sourceEntryId,
    ]);
    expect(activePathRepo.getSourceEntry(assistant.sourceEntryId)).toEqual(assistant);
  });

  it('rejects branch markers whose selected or seed source refs are not persisted in the same session', () => {
    const { activePathRepo, sessionRunRepo } = createRepositories();
    seedSession(sessionRunRepo);
    seedSecondSession(sessionRunRepo);

    const user = activePathRepo.appendSourceEntry(
      sourceEntry('source-entry-1', 'message-user-1', 'session_message'),
    );
    const crossSessionSource = activePathRepo.appendSourceEntry(
      sourceEntry('source-entry-other', 'message-other-session', 'session_message', undefined, 'session-2'),
    );
    const missingSourceRef = sourceRef('message-missing', 'session_message');

    expect(() => activePathRepo.recordBranchMarker({
      branchMarkerId: 'branch-marker-cross-selected',
      sessionId: 'session-1',
      previousLeafSourceEntryId: user.sourceEntryId,
      targetLeafSourceEntryId: user.sourceEntryId,
      selectedSourceRef: crossSessionSource.sourceRef,
      reason: 'branch_from_user_message',
      createdAt: '2026-05-31T12:04:00.000Z',
    })).toThrow(/selectedSourceRef must resolve to a source entry in session session-1/);

    expect(() => activePathRepo.recordBranchMarker({
      branchMarkerId: 'branch-marker-missing-selected',
      sessionId: 'session-1',
      previousLeafSourceEntryId: user.sourceEntryId,
      targetLeafSourceEntryId: user.sourceEntryId,
      selectedSourceRef: missingSourceRef,
      reason: 'branch_from_user_message',
      createdAt: '2026-05-31T12:04:01.000Z',
    })).toThrow(/selectedSourceRef must resolve to a source entry in session session-1/);

    expect(() => activePathRepo.recordBranchMarker({
      branchMarkerId: 'branch-marker-cross-seed',
      sessionId: 'session-1',
      previousLeafSourceEntryId: user.sourceEntryId,
      targetLeafSourceEntryId: user.sourceEntryId,
      selectedSourceRef: user.sourceRef,
      seedSourceRef: crossSessionSource.sourceRef,
      reason: 'branch_from_user_message',
      createdAt: '2026-05-31T12:04:02.000Z',
    })).toThrow(/seedSourceRef must resolve to a source entry in session session-1/);

    expect(() => activePathRepo.recordBranchMarker({
      branchMarkerId: 'branch-marker-missing-seed',
      sessionId: 'session-1',
      previousLeafSourceEntryId: user.sourceEntryId,
      targetLeafSourceEntryId: user.sourceEntryId,
      selectedSourceRef: user.sourceRef,
      seedSourceRef: missingSourceRef,
      reason: 'branch_from_user_message',
      createdAt: '2026-05-31T12:04:03.000Z',
    })).toThrow(/seedSourceRef must resolve to a source entry in session session-1/);

    expect(activePathRepo.listBranchMarkersBySession('session-1')).toEqual([]);
  });

  it('rejects branch markers whose previous or target source entry belongs to another session', () => {
    const { activePathRepo, sessionRunRepo } = createRepositories();
    seedSession(sessionRunRepo);
    seedSecondSession(sessionRunRepo);
    const user = activePathRepo.appendSourceEntry(
      sourceEntry('source-entry-1', 'message-user-1', 'session_message'),
    );
    const otherSource = activePathRepo.appendSourceEntry(
      sourceEntry('source-entry-other', 'message-other-session', 'session_message', undefined, 'session-2'),
    );

    expect(() => activePathRepo.recordBranchMarker({
      branchMarkerId: 'branch-marker-cross-previous',
      sessionId: 'session-1',
      previousLeafSourceEntryId: otherSource.sourceEntryId,
      targetLeafSourceEntryId: user.sourceEntryId,
      selectedSourceRef: user.sourceRef,
      reason: 'branch_from_user_message',
      createdAt: '2026-05-31T12:04:04.000Z',
    })).toThrow(/previousLeafSourceEntryId must belong to session session-1/);

    expect(() => activePathRepo.recordBranchMarker({
      branchMarkerId: 'branch-marker-cross-target',
      sessionId: 'session-1',
      previousLeafSourceEntryId: user.sourceEntryId,
      targetLeafSourceEntryId: otherSource.sourceEntryId,
      selectedSourceRef: user.sourceRef,
      reason: 'branch_from_user_message',
      createdAt: '2026-05-31T12:04:05.000Z',
    })).toThrow(/targetLeafSourceEntryId must belong to session session-1/);

    expect(activePathRepo.listBranchMarkersBySession('session-1')).toEqual([]);
  });

  it('persists retry attempts and interrupted run markers as audit records, including retry status updates', () => {
    const { activePathRepo, sessionRunRepo } = createRepositories();
    seedSession(sessionRunRepo);
    sessionRunRepo.saveRun({
      runId: 'run-1',
      sessionId: 'session-1',
      mode: 'chat',
      goal: 'Answer',
      status: 'running',
      createdAt: '2026-05-31T12:05:00.000Z',
    });
    const user = activePathRepo.appendSourceEntry(
      sourceEntry('source-entry-1', 'message-user-1', 'session_message'),
    );

    activePathRepo.saveRetryAttempt({
      retryAttemptId: 'retry-attempt-1',
      sessionId: 'session-1',
      runId: 'run-1',
      baseSourceEntryId: user.sourceEntryId,
      attemptNumber: 1,
      retryKind: 'manual_retry',
      reason: 'failed',
      status: 'running',
      retryable: true,
      createdAt: '2026-05-31T12:05:01.000Z',
      metadata: { backoffMs: 250 },
    });
    activePathRepo.saveRetryAttempt({
      retryAttemptId: 'retry-attempt-1',
      sessionId: 'session-1',
      runId: 'run-1',
      baseSourceEntryId: user.sourceEntryId,
      attemptNumber: 1,
      retryKind: 'manual_retry',
      reason: 'failed',
      status: 'failed',
      retryable: true,
      createdAt: '2026-05-31T12:05:01.000Z',
      completedAt: '2026-05-31T12:05:02.000Z',
      error: {
        code: 'provider_network_error',
        message: 'Provider stream timed out.',
        severity: 'warning',
        retryable: true,
        source: 'provider',
      },
    });
    activePathRepo.recordInterruptedRunMarker({
      interruptedMarkerId: 'interrupted-marker-1',
      sessionId: 'session-1',
      runId: 'run-1',
      previousStatus: 'running',
      reason: 'app_restarted',
      markedAt: '2026-05-31T12:06:00.000Z',
      metadata: { source: 'startup-scan' },
    });

    expect(activePathRepo.listRetryAttemptsByRun('run-1')).toEqual([
      expect.objectContaining({
        retryAttemptId: 'retry-attempt-1',
        status: 'failed',
        error: expect.objectContaining({ code: 'provider_network_error' }),
      }),
    ]);
    expect(activePathRepo.listInterruptedRunMarkersByRun('run-1')).toEqual([
      expect.objectContaining({
        interruptedMarkerId: 'interrupted-marker-1',
        previousStatus: 'running',
        reason: 'app_restarted',
      }),
    ]);
  });

  it('updates retry attempts only through mutable audit fields while preserving createdAt', () => {
    const { activePathRepo, sessionRunRepo } = createRepositories();
    seedSession(sessionRunRepo);
    seedRun(sessionRunRepo, 'base-run-1');
    seedRun(sessionRunRepo);
    activePathRepo.appendSourceEntry(sourceEntry('source-entry-1', 'message-user-1', 'session_message'));

    const initialAttempt = activePathRepo.saveRetryAttempt(retryAttempt({
      metadata: { backoffMs: 250 },
    }));
    const updatedAttempt = activePathRepo.saveRetryAttempt({
      ...initialAttempt,
      status: 'failed',
      completedAt: '2026-05-31T12:05:02.000Z',
      error: {
        code: 'provider_network_error',
        message: 'Provider stream timed out.',
        severity: 'warning',
        retryable: true,
        source: 'provider',
      },
      metadata: { backoffMs: 500 },
    });

    expect(updatedAttempt).toEqual(expect.objectContaining({
      retryAttemptId: 'retry-attempt-1',
      sessionId: 'session-1',
      runId: 'run-1',
      baseRunId: 'base-run-1',
      baseSourceEntryId: 'source-entry-1',
      attemptNumber: 1,
      retryKind: 'manual_retry',
      reason: 'failed',
      retryable: true,
      createdAt: '2026-05-31T12:05:01.000Z',
      status: 'failed',
      completedAt: '2026-05-31T12:05:02.000Z',
      metadata: { backoffMs: 500 },
    }));
    expect(activePathRepo.listRetryAttemptsByRun('run-1')).toEqual([updatedAttempt]);
  });

  it('rejects retry attempt updates that change immutable identity or base fields', () => {
    const { activePathRepo, sessionRunRepo } = createRepositories();
    seedSession(sessionRunRepo);
    seedSecondSession(sessionRunRepo);
    seedRun(sessionRunRepo, 'base-run-1');
    seedRun(sessionRunRepo);
    seedRun(sessionRunRepo, 'run-other', 'session-2');
    activePathRepo.appendSourceEntry(sourceEntry('source-entry-1', 'message-user-1', 'session_message'));
    activePathRepo.appendSourceEntry(
      sourceEntry('source-entry-other', 'message-user-other', 'session_message', undefined, 'session-2'),
    );

    const initialAttempt = activePathRepo.saveRetryAttempt(retryAttempt());
    const immutableChanges: Array<[string, Partial<SessionRetryAttempt>]> = [
      ['sessionId', { sessionId: 'session-2', runId: 'run-other' }],
      ['runId', { runId: 'base-run-1' }],
      ['baseRunId', { baseRunId: 'run-1' }],
      ['baseSourceEntryId', { baseSourceEntryId: undefined }],
      ['attemptNumber', { attemptNumber: 2 }],
      ['retryKind', { retryKind: 'manual_rerun' }],
      ['reason', { reason: 'interrupted' }],
      ['retryable', { retryable: false }],
      ['createdAt', { createdAt: '2026-05-31T12:05:09.000Z' }],
    ];

    for (const [fieldName, change] of immutableChanges) {
      expect(() => activePathRepo.saveRetryAttempt({
        ...initialAttempt,
        ...change,
        status: 'failed',
      })).toThrow(new RegExp(`immutable field ${fieldName}`));
    }

    expect(activePathRepo.listRetryAttemptsByRun('run-1')).toEqual([initialAttempt]);
  });

  it('rejects initial retry attempts whose run, base run, or base source belongs to another session', () => {
    const { activePathRepo, sessionRunRepo } = createRepositories();
    seedSession(sessionRunRepo);
    seedSecondSession(sessionRunRepo);
    seedRun(sessionRunRepo, 'run-1');
    seedRun(sessionRunRepo, 'base-run-1');
    seedRun(sessionRunRepo, 'run-other', 'session-2');
    const baseSource = activePathRepo.appendSourceEntry(
      sourceEntry('source-entry-1', 'message-user-1', 'session_message'),
    );
    const otherSource = activePathRepo.appendSourceEntry(
      sourceEntry('source-entry-other', 'message-other-session', 'session_message', undefined, 'session-2'),
    );

    expect(() => activePathRepo.saveRetryAttempt(retryAttempt({
      retryAttemptId: 'retry-attempt-cross-run',
      runId: 'run-other',
      baseSourceEntryId: baseSource.sourceEntryId,
    }))).toThrow(/runId must belong to session session-1/);

    expect(() => activePathRepo.saveRetryAttempt(retryAttempt({
      retryAttemptId: 'retry-attempt-cross-base-run',
      baseRunId: 'run-other',
      baseSourceEntryId: baseSource.sourceEntryId,
    }))).toThrow(/baseRunId must belong to session session-1/);

    expect(() => activePathRepo.saveRetryAttempt(retryAttempt({
      retryAttemptId: 'retry-attempt-cross-base-source',
      baseSourceEntryId: otherSource.sourceEntryId,
    }))).toThrow(/baseSourceEntryId must belong to session session-1/);

    expect(activePathRepo.listRetryAttemptsByRun('run-1')).toEqual([]);
  });

  it('rejects interrupted run markers whose run belongs to another session', () => {
    const { activePathRepo, sessionRunRepo } = createRepositories();
    seedSession(sessionRunRepo);
    seedSecondSession(sessionRunRepo);
    seedRun(sessionRunRepo, 'run-other', 'session-2');

    expect(() => activePathRepo.recordInterruptedRunMarker({
      interruptedMarkerId: 'interrupted-marker-cross-run',
      sessionId: 'session-1',
      runId: 'run-other',
      previousStatus: 'running',
      reason: 'app_restarted',
      markedAt: '2026-05-31T12:06:01.000Z',
    })).toThrow(/runId must belong to session session-1/);
  });

  it('cascades active path records when a session is deleted', () => {
    const { activePathRepo, sessionRunRepo, database } = createRepositories();
    seedSession(sessionRunRepo);
    sessionRunRepo.saveRun({
      runId: 'run-1',
      sessionId: 'session-1',
      mode: 'chat',
      goal: 'Answer',
      status: 'running',
      createdAt: '2026-05-31T12:07:00.000Z',
    });
    const user = activePathRepo.appendSourceEntry(
      sourceEntry('source-entry-1', 'message-user-1', 'session_message'),
    );
    activePathRepo.setActiveLeaf({
      sessionId: 'session-1',
      leafSourceEntryId: user.sourceEntryId,
      updatedAt: '2026-05-31T12:07:01.000Z',
      reason: 'source_appended',
    });
    activePathRepo.recordBranchMarker({
      branchMarkerId: 'branch-marker-1',
      sessionId: 'session-1',
      previousLeafSourceEntryId: user.sourceEntryId,
      targetLeafSourceEntryId: user.sourceEntryId,
      selectedSourceRef: user.sourceRef,
      reason: 'branch_from_user_message',
      createdAt: '2026-05-31T12:07:02.000Z',
    });
    activePathRepo.saveRetryAttempt({
      retryAttemptId: 'retry-attempt-1',
      sessionId: 'session-1',
      runId: 'run-1',
      attemptNumber: 1,
      retryKind: 'manual_retry',
      reason: 'failed',
      status: 'pending',
      retryable: true,
      createdAt: '2026-05-31T12:07:03.000Z',
    });
    activePathRepo.recordInterruptedRunMarker({
      interruptedMarkerId: 'interrupted-marker-1',
      sessionId: 'session-1',
      runId: 'run-1',
      previousStatus: 'running',
      reason: 'runtime_lost',
      markedAt: '2026-05-31T12:07:04.000Z',
    });

    database.prepare('DELETE FROM sessions WHERE session_id = ?').run('session-1');

    for (const tableName of [
      'session_source_entries',
      'session_active_leaves',
      'session_branch_markers',
      'session_retry_attempts',
      'session_interrupted_run_markers',
    ]) {
      expect((database.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number }).count).toBe(0);
    }
  });

  it('fails closed when the active leaf references a missing source entry', () => {
    const { activePathRepo, sessionRunRepo, database } = createRepositories();
    seedSession(sessionRunRepo);

    const leaf = activePathRepo.appendSourceEntry(
      sourceEntry('source-entry-missing', 'message-missing', 'session_message'),
    );
    activePathRepo.setActiveLeaf({
      sessionId: 'session-1',
      leafSourceEntryId: leaf.sourceEntryId,
      updatedAt: '2026-05-31T12:08:00.000Z',
      reason: 'source_appended',
    });

    database.pragma('foreign_keys = OFF');
    database.prepare('DELETE FROM session_source_entries WHERE source_entry_id = ?').run(leaf.sourceEntryId);
    database.pragma('foreign_keys = ON');

    expect(() => activePathRepo.getActivePath('session-1')).toThrow(
      /Active path source entry source-entry-missing was not found/,
    );
  });
});

