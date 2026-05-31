import { describe, expect, it } from 'vitest';

import {
  SESSION_ACTIVE_LEAF_REASONS,
  SESSION_BRANCH_MARKER_REASONS,
  SESSION_INTERRUPTED_RUN_PREVIOUS_STATUSES,
  SESSION_INTERRUPTED_RUN_REASONS,
  SESSION_RETRY_ATTEMPT_STATUSES,
  SESSION_RETRY_KINDS,
  SESSION_RETRY_REASONS,
  SessionActiveLeafSchema,
  SessionActivePathSchema,
  SessionBranchMarkerSchema,
  SessionInterruptedRunMarkerSchema,
  SessionRetryAttemptSchema,
  SessionSourceEntrySchema,
  type SessionSourceEntry,
} from '@megumi/shared/session-active-path-contracts';

const now = '2026-05-31T12:00:00.000Z';

const rootEntry: SessionSourceEntry = {
  sourceEntryId: 'source-entry:user-1',
  sessionId: 'session-1',
  sourceRef: {
    sourceId: 'message-1',
    sourceKind: 'session_message',
    sourceUri: 'session-message://message-1',
    loadedAt: now,
  },
  createdAt: now,
  metadata: { role: 'user' },
};

describe('session active path contracts', () => {
  it('parses source entries and active paths strictly', () => {
    const assistantEntry: SessionSourceEntry = {
      sourceEntryId: 'source-entry:assistant-1',
      sessionId: 'session-1',
      parentSourceEntryId: rootEntry.sourceEntryId,
      sourceRef: {
        sourceId: 'message-2',
        sourceKind: 'session_message',
        sourceUri: 'session-message://message-2',
        loadedAt: now,
      },
      createdAt: '2026-05-31T12:01:00.000Z',
    };

    expect(SessionSourceEntrySchema.parse(rootEntry)).toEqual(rootEntry);
    expect(SessionActivePathSchema.parse({
      sessionId: 'session-1',
      leafSourceEntryId: assistantEntry.sourceEntryId,
      entries: [rootEntry, assistantEntry],
    })).toEqual({
      sessionId: 'session-1',
      leafSourceEntryId: assistantEntry.sourceEntryId,
      entries: [rootEntry, assistantEntry],
    });

    expect(() => SessionSourceEntrySchema.parse({
      ...rootEntry,
      rawPrompt: 'must not be accepted',
    })).toThrow();
  });

  it('rejects invalid active path invariants', () => {
    const assistantEntry: SessionSourceEntry = {
      sourceEntryId: 'source-entry:assistant-1',
      sessionId: 'session-1',
      parentSourceEntryId: rootEntry.sourceEntryId,
      sourceRef: {
        sourceId: 'message-2',
        sourceKind: 'session_message',
        sourceUri: 'session-message://message-2',
        loadedAt: now,
      },
      createdAt: '2026-05-31T12:01:00.000Z',
    };

    expect(() => SessionActivePathSchema.parse({
      sessionId: 'session-1',
      leafSourceEntryId: assistantEntry.sourceEntryId,
      entries: [{ ...assistantEntry, sessionId: 'session-2' }],
    })).toThrow();

    expect(() => SessionActivePathSchema.parse({
      sessionId: 'session-1',
      leafSourceEntryId: 'source-entry:missing',
      entries: [rootEntry, assistantEntry],
    })).toThrow();

    expect(() => SessionActivePathSchema.parse({
      sessionId: 'session-1',
      leafSourceEntryId: rootEntry.sourceEntryId,
      entries: [rootEntry, assistantEntry],
    })).toThrow();

    expect(() => SessionActivePathSchema.parse({
      sessionId: 'session-1',
      leafSourceEntryId: rootEntry.sourceEntryId,
      entries: [],
    })).toThrow();
  });

  it('parses active leaf state with nullable leaf semantics', () => {
    expect(SessionActiveLeafSchema.parse({
      sessionId: 'session-1',
      leafSourceEntryId: rootEntry.sourceEntryId,
      updatedAt: now,
      reason: 'source_appended',
    })).toMatchObject({
      sessionId: 'session-1',
      reason: 'source_appended',
    });

    expect(SessionActiveLeafSchema.parse({
      sessionId: 'session-empty',
      updatedAt: now,
      reason: 'session_created',
    })).toEqual({
      sessionId: 'session-empty',
      updatedAt: now,
      reason: 'session_created',
    });

    expect(SessionActiveLeafSchema.parse({
      sessionId: 'session-empty',
      leafSourceEntryId: null,
      updatedAt: now,
      reason: 'session_created',
    })).toEqual({
      sessionId: 'session-empty',
      leafSourceEntryId: null,
      updatedAt: now,
      reason: 'session_created',
    });
  });

  it('parses durable branch markers without mutating old history', () => {
    const parsed = SessionBranchMarkerSchema.parse({
      branchMarkerId: 'branch-marker-1',
      sessionId: 'session-1',
      previousLeafSourceEntryId: 'source-entry:assistant-1',
      targetLeafSourceEntryId: rootEntry.sourceEntryId,
      selectedSourceRef: rootEntry.sourceRef,
      seedSourceRef: rootEntry.sourceRef,
      reason: 'branch_from_user_message',
      createdAt: now,
      metadata: { actor: 'user' },
    });

    expect(parsed.reason).toBe('branch_from_user_message');
    expect(parsed.selectedSourceRef.sourceKind).toBe('session_message');
    expect(() => SessionBranchMarkerSchema.parse({
      ...parsed,
      selectedSourceRef: { sourceId: 'bad', sourceKind: 'tool_use' },
    })).toThrow();
  });

  it('parses retry attempt audit records without raw provider bodies', () => {
    const parsed = SessionRetryAttemptSchema.parse({
      retryAttemptId: 'retry-attempt-1',
      sessionId: 'session-1',
      runId: 'run-1',
      baseRunId: 'run-0',
      baseSourceEntryId: rootEntry.sourceEntryId,
      attemptNumber: 1,
      retryKind: 'automatic_model_step',
      reason: 'rate_limited',
      status: 'failed',
      retryable: true,
      createdAt: now,
      completedAt: '2026-05-31T12:00:03.000Z',
      error: {
        code: 'provider_rate_limited',
        message: 'Provider returned a retryable 429.',
        severity: 'warning',
        retryable: true,
        source: 'provider',
      },
      metadata: { backoffMs: 250 },
    });

    expect(parsed.retryKind).toBe('automatic_model_step');
    expect(parsed.reason).toBe('rate_limited');
    expect(JSON.stringify(parsed)).not.toContain('rawProviderBody');
    expect(() => SessionRetryAttemptSchema.parse({
      ...parsed,
      rawProviderBody: 'must not be accepted',
    })).toThrow();
  });

  it('parses interrupted run markers with previous run status', () => {
    const parsed = SessionInterruptedRunMarkerSchema.parse({
      interruptedMarkerId: 'interrupted-marker-1',
      sessionId: 'session-1',
      runId: 'run-1',
      previousStatus: 'running',
      reason: 'app_restarted',
      markedAt: now,
      metadata: { owner: 'startup-scan' },
    });

    expect(parsed.previousStatus).toBe('running');
    expect(parsed.reason).toBe('app_restarted');

    for (const previousStatus of ['completed', 'failed', 'cancelled', 'waiting_for_approval'] as const) {
      expect(() => SessionInterruptedRunMarkerSchema.parse({
        interruptedMarkerId: `interrupted-marker:${previousStatus}`,
        sessionId: 'session-1',
        runId: 'run-1',
        previousStatus,
        reason: 'app_restarted',
        markedAt: now,
      })).toThrow();
    }
  });

  it('exports stable enum values for later runtime wiring', () => {
    expect(SESSION_ACTIVE_LEAF_REASONS).toEqual([
      'session_created',
      'source_appended',
      'branch_marker',
      'branch_cancelled',
      'manual_repair',
    ]);
    expect(SESSION_BRANCH_MARKER_REASONS).toEqual([
      'branch_from_user_message',
      'branch_cancelled',
    ]);
    expect(SESSION_RETRY_KINDS).toEqual([
      'automatic_model_step',
      'manual_retry',
      'manual_rerun',
    ]);
    expect(SESSION_RETRY_REASONS).toContain('rate_limited');
    expect(SESSION_RETRY_REASONS).toContain('interrupted');
    expect(SESSION_RETRY_ATTEMPT_STATUSES).toEqual([
      'pending',
      'running',
      'succeeded',
      'failed',
      'cancelled',
      'exhausted',
    ]);
    expect(SESSION_INTERRUPTED_RUN_REASONS).toEqual([
      'app_restarted',
      'host_shutdown',
      'runtime_lost',
    ]);
    expect(SESSION_INTERRUPTED_RUN_PREVIOUS_STATUSES).toEqual([
      'queued',
      'running',
      'cancelling',
    ]);
  });
});
