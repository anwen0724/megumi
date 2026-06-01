import type { ModelInputContextSourceRef } from '@megumi/shared/model-input-context-contracts';
import type { JsonObject } from '@megumi/shared/json';
import {
  SessionActiveLeafSchema,
  SessionActivePathSchema,
  SessionBranchMarkerSchema,
  SessionInterruptedRunMarkerSchema,
  SessionRetryAttemptSchema,
  SessionSourceEntrySchema,
  type SessionActiveLeaf,
  type SessionActivePath,
  type SessionBranchMarker,
  type SessionInterruptedRunMarker,
  type SessionRetryAttempt,
  type SessionSourceEntry,
} from '@megumi/shared/session-active-path-contracts';

import type { MegumiDatabase } from '../connection';

type Nullable<T> = T | null;

interface SourceEntryRow {
  source_entry_id: string;
  session_id: string;
  parent_source_entry_id: Nullable<string>;
  source_ref_json: string;
  created_at: string;
  metadata_json: Nullable<string>;
}

interface ActiveLeafRow {
  session_id: string;
  leaf_source_entry_id: Nullable<string>;
  updated_at: string;
  reason: SessionActiveLeaf['reason'];
  metadata_json: Nullable<string>;
}

interface BranchMarkerRow {
  branch_marker_json: string;
}

interface RetryAttemptRow {
  attempt_json: string;
}

interface InterruptedRunMarkerRow {
  marker_json: string;
}

type SourceRefLookup = Pick<ModelInputContextSourceRef, 'sourceKind' | 'sourceId'>;

export class SessionActivePathRepository {
  constructor(private readonly database: MegumiDatabase) {}

  appendSourceEntry(entry: SessionSourceEntry): SessionSourceEntry {
    const parsed = SessionSourceEntrySchema.parse(entry);
    if (parsed.parentSourceEntryId) {
      this.assertSourceEntryBelongsToSession(
        parsed.sessionId,
        parsed.parentSourceEntryId,
        'parentSourceEntryId',
      );
    }

    this.database.prepare(`
      INSERT INTO session_source_entries (
        source_entry_id,
        session_id,
        parent_source_entry_id,
        source_kind,
        source_id,
        source_uri,
        source_ref_json,
        created_at,
        metadata_json
      ) VALUES (
        @source_entry_id,
        @session_id,
        @parent_source_entry_id,
        @source_kind,
        @source_id,
        @source_uri,
        @source_ref_json,
        @created_at,
        @metadata_json
      )
    `).run({
      source_entry_id: parsed.sourceEntryId,
      session_id: parsed.sessionId,
      parent_source_entry_id: parsed.parentSourceEntryId ?? null,
      source_kind: parsed.sourceRef.sourceKind,
      source_id: parsed.sourceRef.sourceId,
      source_uri: parsed.sourceRef.sourceUri ?? null,
      source_ref_json: stringifyJson(parsed.sourceRef),
      created_at: parsed.createdAt,
      metadata_json: parsed.metadata ? stringifyJson(parsed.metadata) : null,
    });

    return parsed;
  }

  appendSourceEntryAndSetActiveLeaf(
    entry: SessionSourceEntry,
    activeLeaf: SessionActiveLeaf,
  ): SessionSourceEntry {
    const appendAndSetActiveLeaf = this.database.transaction((
      sourceEntry: SessionSourceEntry,
      nextActiveLeaf: SessionActiveLeaf,
    ) => {
      const appended = this.appendSourceEntry(sourceEntry);
      this.setActiveLeaf(nextActiveLeaf);
      return appended;
    });

    return appendAndSetActiveLeaf(entry, activeLeaf);
  }

  getSourceEntry(sourceEntryId: string): SessionSourceEntry | undefined {
    const row = this.database
      .prepare('SELECT * FROM session_source_entries WHERE source_entry_id = ?')
      .get(sourceEntryId) as SourceEntryRow | undefined;

    return row ? fromSourceEntryRow(row) : undefined;
  }

  getSourceEntryBySourceRef(
    sessionId: string,
    sourceRef: SourceRefLookup,
  ): SessionSourceEntry | undefined {
    const row = this.database.prepare(`
      SELECT *
      FROM session_source_entries
      WHERE session_id = ?
        AND source_kind = ?
        AND source_id = ?
    `).get(sessionId, sourceRef.sourceKind, sourceRef.sourceId) as SourceEntryRow | undefined;

    return row ? fromSourceEntryRow(row) : undefined;
  }

  listSourceEntriesBySession(sessionId: string): SessionSourceEntry[] {
    return (this.database.prepare(`
      SELECT *
      FROM session_source_entries
      WHERE session_id = ?
      ORDER BY created_at ASC, source_entry_id ASC
    `).all(sessionId) as SourceEntryRow[]).map(fromSourceEntryRow);
  }

  setActiveLeaf(activeLeaf: SessionActiveLeaf): SessionActiveLeaf {
    const parsed = SessionActiveLeafSchema.parse(activeLeaf);
    if (parsed.leafSourceEntryId) {
      this.assertSourceEntryBelongsToSession(
        parsed.sessionId,
        parsed.leafSourceEntryId,
        'leafSourceEntryId',
      );
    }

    this.database.prepare(`
      INSERT INTO session_active_leaves (
        session_id,
        leaf_source_entry_id,
        updated_at,
        reason,
        metadata_json
      ) VALUES (
        @session_id,
        @leaf_source_entry_id,
        @updated_at,
        @reason,
        @metadata_json
      )
      ON CONFLICT(session_id) DO UPDATE SET
        leaf_source_entry_id = excluded.leaf_source_entry_id,
        updated_at = excluded.updated_at,
        reason = excluded.reason,
        metadata_json = excluded.metadata_json
    `).run({
      session_id: parsed.sessionId,
      leaf_source_entry_id: parsed.leafSourceEntryId ?? null,
      updated_at: parsed.updatedAt,
      reason: parsed.reason,
      metadata_json: parsed.metadata ? stringifyJson(parsed.metadata) : null,
    });

    return this.getActiveLeaf(parsed.sessionId) ?? parsed;
  }

  getActiveLeaf(sessionId: string): SessionActiveLeaf | undefined {
    const row = this.database
      .prepare('SELECT * FROM session_active_leaves WHERE session_id = ?')
      .get(sessionId) as ActiveLeafRow | undefined;

    return row ? fromActiveLeafRow(row) : undefined;
  }

  getActivePath(sessionId: string): SessionActivePath {
    const activeLeaf = this.getActiveLeaf(sessionId);
    if (!activeLeaf?.leafSourceEntryId) {
      return SessionActivePathSchema.parse({
        sessionId,
        entries: [],
      });
    }

    const entriesById = new Map(
      this.listSourceEntriesBySession(sessionId).map((entry) => [entry.sourceEntryId, entry]),
    );
    const path: SessionSourceEntry[] = [];
    const seen = new Set<string>();
    let currentId: string | undefined = activeLeaf.leafSourceEntryId;

    while (currentId) {
      if (seen.has(currentId)) {
        throw new Error(`Cycle detected in session active path for ${sessionId}: ${currentId}`);
      }
      seen.add(currentId);

      const entry = entriesById.get(currentId);
      if (!entry) {
        throw new Error(`Active path source entry ${currentId} was not found in session ${sessionId}`);
      }

      path.unshift(entry);
      currentId = entry.parentSourceEntryId;
    }

    return SessionActivePathSchema.parse({
      sessionId,
      leafSourceEntryId: activeLeaf.leafSourceEntryId,
      entries: path,
    });
  }

  listActivePathSourceRefs(sessionId: string): ModelInputContextSourceRef[] {
    return this.getActivePath(sessionId).entries.map((entry) => entry.sourceRef);
  }

  findActivePathEntryBySourceRef(
    sessionId: string,
    sourceRef: SourceRefLookup,
  ): SessionSourceEntry | undefined {
    return this.getActivePath(sessionId).entries.find(
      (entry) =>
        entry.sourceRef.sourceKind === sourceRef.sourceKind
        && entry.sourceRef.sourceId === sourceRef.sourceId,
    );
  }

  recordBranchMarker(marker: SessionBranchMarker): SessionBranchMarker {
    const parsed = SessionBranchMarkerSchema.parse(marker);
    if (parsed.previousLeafSourceEntryId) {
      this.assertSourceEntryBelongsToSession(
        parsed.sessionId,
        parsed.previousLeafSourceEntryId,
        'previousLeafSourceEntryId',
      );
    }
    if (parsed.targetLeafSourceEntryId) {
      this.assertSourceEntryBelongsToSession(
        parsed.sessionId,
        parsed.targetLeafSourceEntryId,
        'targetLeafSourceEntryId',
      );
    }
    this.assertSourceRefBelongsToSession(
      parsed.sessionId,
      parsed.selectedSourceRef,
      'selectedSourceRef',
    );
    if (parsed.seedSourceRef) {
      this.assertSourceRefBelongsToSession(
        parsed.sessionId,
        parsed.seedSourceRef,
        'seedSourceRef',
      );
    }

    this.database.prepare(`
      INSERT INTO session_branch_markers (
        branch_marker_id,
        session_id,
        previous_leaf_source_entry_id,
        target_leaf_source_entry_id,
        selected_source_ref_json,
        seed_source_ref_json,
        reason,
        created_at,
        metadata_json,
        branch_marker_json
      ) VALUES (
        @branch_marker_id,
        @session_id,
        @previous_leaf_source_entry_id,
        @target_leaf_source_entry_id,
        @selected_source_ref_json,
        @seed_source_ref_json,
        @reason,
        @created_at,
        @metadata_json,
        @branch_marker_json
      )
    `).run({
      branch_marker_id: parsed.branchMarkerId,
      session_id: parsed.sessionId,
      previous_leaf_source_entry_id: parsed.previousLeafSourceEntryId ?? null,
      target_leaf_source_entry_id: parsed.targetLeafSourceEntryId ?? null,
      selected_source_ref_json: stringifyJson(parsed.selectedSourceRef),
      seed_source_ref_json: parsed.seedSourceRef ? stringifyJson(parsed.seedSourceRef) : null,
      reason: parsed.reason,
      created_at: parsed.createdAt,
      metadata_json: parsed.metadata ? stringifyJson(parsed.metadata) : null,
      branch_marker_json: stringifyJson(parsed),
    });

    return parsed;
  }

  listBranchMarkersBySession(sessionId: string): SessionBranchMarker[] {
    return (this.database.prepare(`
      SELECT branch_marker_json
      FROM session_branch_markers
      WHERE session_id = ?
      ORDER BY created_at ASC, branch_marker_id ASC
    `).all(sessionId) as BranchMarkerRow[]).map((row) =>
      SessionBranchMarkerSchema.parse(parseJson(row.branch_marker_json)),
    );
  }

  getBranchMarker(branchMarkerId: string): SessionBranchMarker | undefined {
    const row = this.database
      .prepare('SELECT branch_marker_json FROM session_branch_markers WHERE branch_marker_id = ?')
      .get(branchMarkerId) as BranchMarkerRow | undefined;

    return row ? SessionBranchMarkerSchema.parse(parseJson(row.branch_marker_json)) : undefined;
  }

  listChildSourceEntries(parentSourceEntryId: string): SessionSourceEntry[] {
    return (this.database.prepare(`
      SELECT *
      FROM session_source_entries
      WHERE parent_source_entry_id = ?
      ORDER BY created_at ASC, source_entry_id ASC
    `).all(parentSourceEntryId) as SourceEntryRow[]).map(fromSourceEntryRow);
  }

  saveRetryAttempt(attempt: SessionRetryAttempt): SessionRetryAttempt {
    const parsed = SessionRetryAttemptSchema.parse(attempt);
    const existing = this.getRetryAttempt(parsed.retryAttemptId);
    const persisted = existing
      ? mergeRetryAttemptUpdate(existing, parsed)
      : parsed;
    this.assertRunBelongsToSession(persisted.sessionId, persisted.runId, 'runId');
    if (persisted.baseRunId) {
      this.assertRunBelongsToSession(persisted.sessionId, persisted.baseRunId, 'baseRunId');
    }
    if (persisted.baseSourceEntryId) {
      this.assertSourceEntryBelongsToSession(
        persisted.sessionId,
        persisted.baseSourceEntryId,
        'baseSourceEntryId',
      );
    }

    this.database.prepare(`
      INSERT INTO session_retry_attempts (
        retry_attempt_id,
        session_id,
        run_id,
        base_run_id,
        base_source_entry_id,
        attempt_number,
        retry_kind,
        reason,
        status,
        retryable,
        created_at,
        completed_at,
        error_json,
        metadata_json,
        attempt_json
      ) VALUES (
        @retry_attempt_id,
        @session_id,
        @run_id,
        @base_run_id,
        @base_source_entry_id,
        @attempt_number,
        @retry_kind,
        @reason,
        @status,
        @retryable,
        @created_at,
        @completed_at,
        @error_json,
        @metadata_json,
        @attempt_json
      )
      ON CONFLICT(retry_attempt_id) DO UPDATE SET
        session_id = excluded.session_id,
        run_id = excluded.run_id,
        base_run_id = excluded.base_run_id,
        base_source_entry_id = excluded.base_source_entry_id,
        attempt_number = excluded.attempt_number,
        retry_kind = excluded.retry_kind,
        reason = excluded.reason,
        status = excluded.status,
        retryable = excluded.retryable,
        completed_at = excluded.completed_at,
        error_json = excluded.error_json,
        metadata_json = excluded.metadata_json,
        attempt_json = excluded.attempt_json
    `).run({
      retry_attempt_id: persisted.retryAttemptId,
      session_id: persisted.sessionId,
      run_id: persisted.runId,
      base_run_id: persisted.baseRunId ?? null,
      base_source_entry_id: persisted.baseSourceEntryId ?? null,
      attempt_number: persisted.attemptNumber,
      retry_kind: persisted.retryKind,
      reason: persisted.reason,
      status: persisted.status,
      retryable: persisted.retryable ? 1 : 0,
      created_at: persisted.createdAt,
      completed_at: persisted.completedAt ?? null,
      error_json: persisted.error ? stringifyJson(persisted.error) : null,
      metadata_json: persisted.metadata ? stringifyJson(persisted.metadata) : null,
      attempt_json: stringifyJson(persisted),
    });

    return persisted;
  }

  listRetryAttemptsByRun(runId: string): SessionRetryAttempt[] {
    return (this.database.prepare(`
      SELECT attempt_json
      FROM session_retry_attempts
      WHERE run_id = ?
      ORDER BY attempt_number ASC, created_at ASC, retry_attempt_id ASC
    `).all(runId) as RetryAttemptRow[]).map((row) =>
      SessionRetryAttemptSchema.parse(parseJson(row.attempt_json)),
    );
  }

  recordInterruptedRunMarker(marker: SessionInterruptedRunMarker): SessionInterruptedRunMarker {
    const parsed = SessionInterruptedRunMarkerSchema.parse(marker);
    this.assertRunBelongsToSession(parsed.sessionId, parsed.runId, 'runId');

    this.database.prepare(`
      INSERT INTO session_interrupted_run_markers (
        interrupted_marker_id,
        session_id,
        run_id,
        previous_status,
        reason,
        marked_at,
        metadata_json,
        marker_json
      ) VALUES (
        @interrupted_marker_id,
        @session_id,
        @run_id,
        @previous_status,
        @reason,
        @marked_at,
        @metadata_json,
        @marker_json
      )
    `).run({
      interrupted_marker_id: parsed.interruptedMarkerId,
      session_id: parsed.sessionId,
      run_id: parsed.runId,
      previous_status: parsed.previousStatus,
      reason: parsed.reason,
      marked_at: parsed.markedAt,
      metadata_json: parsed.metadata ? stringifyJson(parsed.metadata) : null,
      marker_json: stringifyJson(parsed),
    });

    return parsed;
  }

  listInterruptedRunMarkersByRun(runId: string): SessionInterruptedRunMarker[] {
    return (this.database.prepare(`
      SELECT marker_json
      FROM session_interrupted_run_markers
      WHERE run_id = ?
      ORDER BY marked_at ASC, interrupted_marker_id ASC
    `).all(runId) as InterruptedRunMarkerRow[]).map((row) =>
      SessionInterruptedRunMarkerSchema.parse(parseJson(row.marker_json)),
    );
  }

  private getRetryAttempt(retryAttemptId: string): SessionRetryAttempt | undefined {
    const row = this.database
      .prepare('SELECT attempt_json FROM session_retry_attempts WHERE retry_attempt_id = ?')
      .get(retryAttemptId) as RetryAttemptRow | undefined;

    return row ? SessionRetryAttemptSchema.parse(parseJson(row.attempt_json)) : undefined;
  }

  private assertSourceRefBelongsToSession(
    sessionId: string,
    sourceRef: SourceRefLookup,
    fieldName: 'selectedSourceRef' | 'seedSourceRef',
  ): void {
    if (!this.getSourceEntryBySourceRef(sessionId, sourceRef)) {
      throw new Error(`${fieldName} must resolve to a source entry in session ${sessionId}`);
    }
  }

  private assertSourceEntryBelongsToSession(
    sessionId: string,
    sourceEntryId: string,
    fieldName: string,
  ): void {
    const row = this.database
      .prepare(`
        SELECT 1 AS found
        FROM session_source_entries
        WHERE session_id = ?
          AND source_entry_id = ?
      `)
      .get(sessionId, sourceEntryId) as { found: 1 } | undefined;

    if (!row) {
      throw new Error(`${fieldName} must belong to session ${sessionId}`);
    }
  }

  private assertRunBelongsToSession(
    sessionId: string,
    runId: string,
    fieldName: string,
  ): void {
    const row = this.database
      .prepare(`
        SELECT 1 AS found
        FROM runs
        WHERE session_id = ?
          AND run_id = ?
      `)
      .get(sessionId, runId) as { found: 1 } | undefined;

    if (!row) {
      throw new Error(`${fieldName} must belong to session ${sessionId}`);
    }
  }
}

function mergeRetryAttemptUpdate(
  existing: SessionRetryAttempt,
  next: SessionRetryAttempt,
): SessionRetryAttempt {
  for (const fieldName of RETRY_ATTEMPT_IMMUTABLE_FIELDS) {
    if (existing[fieldName] !== next[fieldName]) {
      throw new Error(`Cannot update immutable field ${fieldName} for retry attempt ${existing.retryAttemptId}`);
    }
  }

  return SessionRetryAttemptSchema.parse({
    ...existing,
    status: next.status,
    completedAt: next.completedAt,
    error: next.error,
    metadata: next.metadata,
  });
}

const RETRY_ATTEMPT_IMMUTABLE_FIELDS = [
  'sessionId',
  'runId',
  'baseRunId',
  'baseSourceEntryId',
  'attemptNumber',
  'retryKind',
  'reason',
  'retryable',
  'createdAt',
] as const satisfies readonly (keyof SessionRetryAttempt)[];

function fromSourceEntryRow(row: SourceEntryRow): SessionSourceEntry {
  return SessionSourceEntrySchema.parse({
    sourceEntryId: row.source_entry_id,
    sessionId: row.session_id,
    parentSourceEntryId: row.parent_source_entry_id ?? undefined,
    sourceRef: parseJson(row.source_ref_json),
    createdAt: row.created_at,
    metadata: parseOptionalJson(row.metadata_json),
  });
}

function fromActiveLeafRow(row: ActiveLeafRow): SessionActiveLeaf {
  return SessionActiveLeafSchema.parse({
    sessionId: row.session_id,
    leafSourceEntryId: row.leaf_source_entry_id ?? undefined,
    updatedAt: row.updated_at,
    reason: row.reason,
    metadata: parseOptionalJson(row.metadata_json),
  });
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}

function parseJson<T = unknown>(value: string): T {
  return JSON.parse(value) as T;
}

function parseOptionalJson(value: string | null): JsonObject | undefined {
  return value ? parseJson<JsonObject>(value) : undefined;
}
