// Aggregates persistence repository implementations for the spec-aligned database redesign.
import { randomUUID } from 'node:crypto';

import type { MegumiDatabase } from '../connection';

import type { JsonObject } from '@megumi/shared/primitives';

import type { ModelInputContextSourceRef } from '@megumi/shared/model';

import {
  SessionActiveLeafSchema,
  SessionActivePathSchema,
  SessionBranchMarkerSchema,
  SessionCompactionEntrySchema,
  SessionInterruptedRunMarkerSchema,
  SessionRetryAttemptSchema,
  SessionSourceEntrySchema,
  type Session,
  type SessionActiveLeaf,
  type SessionActivePath,
  type SessionBranchMarker,
  type SessionCompactionEntry,
  type SessionInterruptedRunMarker,
  type SessionMessage,
  type SessionRetryAttempt,
  type SessionSourceEntry,
} from '@megumi/shared/session';



namespace NewSchemaCompat {
// Shared compatibility helpers while repositories are moved onto the Drizzle schema.

const defaultWorkspaceId = 'workspace:default';

export function ensureWorkspace(
  database: MegumiDatabase,
  input: { workspaceId?: string | null; workspacePath?: string | null; now: string },
): string {
  const workspaceId = input.workspaceId ?? defaultWorkspaceId;
  const existing = database.prepare('SELECT workspace_id FROM workspaces WHERE workspace_id = ?')
    .get(workspaceId) as { workspace_id: string } | undefined;

  if (!existing) {
    throw new Error(`Workspace ${workspaceId} must be created before session persistence.`);
  }

  return workspaceId;
}

export function defaultBranchIdForSession(sessionId: string): string {
  return `${sessionId}:branch:default`;
}

export function ensureSessionDefaultBranch(
  database: MegumiDatabase,
  input: { sessionId: string; now: string },
): string {
  const session = database.prepare(`
    SELECT session_id
    FROM sessions
    WHERE session_id = ?
  `).get(input.sessionId) as
    | { session_id: string }
    | undefined;

  if (!session) {
    throw new Error(`Session ${input.sessionId} does not exist`);
  }

  return session.session_id;
}

export function activeBranchIdForSession(database: MegumiDatabase, sessionId: string, now: string): string {
  return ensureSessionDefaultBranch(database, { sessionId, now });
}

export function appendPathNode(
  database: MegumiDatabase,
  input: {
    pathNodeId: string;
    sessionId: string;
    branchId: string;
    parentPathNodeId?: string | null;
    sourceKind: string;
    sourceId: string;
    createdAt: string;
    metadataJson?: string | null;
  },
): void {
  const current = database.prepare('SELECT active_entry_id FROM sessions WHERE session_id = ?')
    .get(input.sessionId) as { active_entry_id: string | null } | undefined;
  if (!current) {
    throw new Error(`Session ${input.sessionId} does not exist`);
  }

  database.prepare(`
    INSERT INTO session_entries (
      entry_id, session_id, parent_entry_id, entry_kind, message_id, compaction_id, target_entry_id, created_at, metadata_json
    ) VALUES (
      @entry_id, @session_id, @parent_entry_id, @entry_kind, @message_id, NULL, NULL, @created_at, @metadata_json
    )
    ON CONFLICT(entry_id) DO UPDATE SET
      metadata_json = excluded.metadata_json
  `).run({
    entry_id: input.pathNodeId,
    session_id: input.sessionId,
    parent_entry_id: input.parentPathNodeId ?? current.active_entry_id ?? null,
    entry_kind: input.sourceKind === 'session_message' ? 'message' : input.sourceKind,
    message_id: input.sourceKind === 'session_message' ? input.sourceId : null,
    created_at: input.createdAt,
    metadata_json: input.metadataJson ?? null,
  });

  database.prepare(`
    UPDATE sessions
    SET active_entry_id = @entry_id,
        updated_at = @created_at
    WHERE session_id = @session_id
  `).run({
    entry_id: input.pathNodeId,
    session_id: input.sessionId,
    created_at: input.createdAt,
  });
}
}



export const ensureWorkspace = NewSchemaCompat.ensureWorkspace;

export const defaultBranchIdForSession = NewSchemaCompat.defaultBranchIdForSession;

export const ensureSessionDefaultBranch = NewSchemaCompat.ensureSessionDefaultBranch;

export const activeBranchIdForSession = NewSchemaCompat.activeBranchIdForSession;

export const appendPathNode = NewSchemaCompat.appendPathNode;

namespace SessionRepositoryParts {
// Owns persisted Coding Agent session records.

type Nullable<T> = T | null;

interface SessionRow {
  session_id: string;
  title: string;
  workspace_id: Nullable<string>;
  workspace_path: Nullable<string>;
  status: Session['status'];
  created_at: string;
  updated_at: string;
  archived_at: Nullable<string>;
  summary: Nullable<string>;
  metadata_json: Nullable<string>;
}

export class SessionRecordMethods {
  constructor(private readonly database: MegumiDatabase) {}

  saveSession(session: Session): Session {
    const row = toSessionRow(session);
    row.workspace_id = ensureWorkspace(this.database, {
      workspaceId: session.workspaceId,
      workspacePath: session.workspacePath,
      now: session.createdAt,
    });
    this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO sessions (
          session_id, workspace_id, title, status, active_entry_id,
          created_at, updated_at, archived_at, metadata_json
        ) VALUES (
          @session_id, @workspace_id, @title, @status, NULL,
          @created_at, @updated_at, @archived_at, @metadata_json
        )
        ON CONFLICT(session_id) DO UPDATE SET
          title = excluded.title,
          workspace_id = excluded.workspace_id,
          status = excluded.status,
          updated_at = excluded.updated_at,
          archived_at = excluded.archived_at,
          metadata_json = excluded.metadata_json
      `).run(row);
    })();

    return this.getSession(session.sessionId) ?? session;
  }

  getSession(sessionId: string): Session | undefined {
    const row = this.database.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId) as
      | SessionRow
      | undefined;
    return row ? fromSessionRow(row) : undefined;
  }

  listSessions(): Session[] {
    return (this.database
      .prepare('SELECT * FROM sessions ORDER BY updated_at DESC')
      .all() as SessionRow[]).map(fromSessionRow);
  }
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}

function parseJson<T>(value: string | null): T | undefined;
function parseJson<T>(value: string): T;
function parseJson<T>(value: string | null): T | undefined {
  return value ? JSON.parse(value) as T : undefined;
}

function toSessionRow(session: Session): SessionRow {
  const metadata = {
    ...(session.metadata ?? {}),
    ...(session.workspacePath ? { workspacePath: session.workspacePath } : {}),
    ...(session.summary ? { summary: session.summary } : {}),
  };
  return {
    session_id: session.sessionId,
    title: session.title,
    workspace_id: session.workspaceId ?? null,
    workspace_path: session.workspacePath ?? null,
    status: session.status,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
    archived_at: session.archivedAt ?? null,
    summary: session.summary ?? null,
    metadata_json: Object.keys(metadata).length > 0 ? stringifyJson(metadata) : null,
  };
}

function fromSessionRow(row: SessionRow): Session {
  const rawMetadata = row.metadata_json ? parseJson<JsonObject>(row.metadata_json) : undefined;
  const metadata = publicSessionMetadata(rawMetadata);
  return {
    sessionId: row.session_id,
    title: row.title,
    ...(row.workspace_id ? { workspaceId: row.workspace_id } : {}),
    ...(row.workspace_path ?? rawMetadata?.workspacePath ? { workspacePath: String(row.workspace_path ?? rawMetadata?.workspacePath) } : {}),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.archived_at ? { archivedAt: row.archived_at } : {}),
    ...(row.summary ?? rawMetadata?.summary ? { summary: String(row.summary ?? rawMetadata?.summary) } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function publicSessionMetadata(metadata: JsonObject | undefined): JsonObject | undefined {
  if (!metadata) {
    return undefined;
  }
  const { workspacePath: _workspacePath, summary: _summary, ...publicMetadata } = metadata;
  return Object.keys(publicMetadata).length > 0 ? publicMetadata : undefined;
}
}

namespace SessionRepositoryParts {
// Owns persisted session message history records for Coding Agent sessions.

type Nullable<T> = T | null;

interface SessionMessageRow {
  message_id: string;
  session_id: string;
  run_id: Nullable<string>;
  role: SessionMessage['role'];
  content_text: string;
  status: SessionMessage['status'];
  created_at: string;
  completed_at: Nullable<string>;
  metadata_json: Nullable<string>;
}

export class SessionMessageMethods {
  constructor(private readonly database: MegumiDatabase) {}

  saveMessage(message: SessionMessage): SessionMessage {
    ensureSessionDefaultBranch(this.database, { sessionId: message.sessionId, now: message.createdAt });
    const row = toSessionMessageRow(message);
    this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO session_messages (
          message_id, session_id, run_id, role, content_text, blocks_json,
          status, created_at, completed_at, metadata_json
        ) VALUES (
          @message_id, @session_id, @run_id, @role, @content_text, NULL,
          @status, @created_at, @completed_at, @metadata_json
        )
        ON CONFLICT(message_id) DO UPDATE SET
          run_id = excluded.run_id,
          content_text = excluded.content_text,
          status = excluded.status,
          completed_at = excluded.completed_at,
          metadata_json = excluded.metadata_json
      `).run(row);

    })();

    return message;
  }

  getMessage(messageId: string): SessionMessage | undefined {
    const row = this.database.prepare('SELECT * FROM session_messages WHERE message_id = ?').get(messageId) as
      | SessionMessageRow
      | undefined;
    return row ? fromSessionMessageRow(row) : undefined;
  }

  listMessagesBySession(sessionId: string): SessionMessage[] {
    return (this.database
      .prepare('SELECT * FROM session_messages WHERE session_id = ? ORDER BY created_at ASC')
      .all(sessionId) as SessionMessageRow[]).map(fromSessionMessageRow);
  }
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}

function parseJson<T>(value: string | null): T | undefined;
function parseJson<T>(value: string): T;
function parseJson<T>(value: string | null): T | undefined {
  return value ? JSON.parse(value) as T : undefined;
}

function toSessionMessageRow(message: SessionMessage): SessionMessageRow {
  return {
    message_id: message.messageId,
    session_id: message.sessionId,
    run_id: message.runId ?? null,
    role: message.role,
    content_text: message.content,
    status: message.status,
    created_at: message.createdAt,
    completed_at: message.completedAt ?? null,
    metadata_json: message.metadata ? stringifyJson(message.metadata) : null,
  };
}

function fromSessionMessageRow(row: SessionMessageRow): SessionMessage {
  return {
    messageId: row.message_id,
    sessionId: row.session_id,
    ...(row.run_id ? { runId: row.run_id } : {}),
    role: row.role,
    content: row.content_text,
    status: row.status,
    createdAt: row.created_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    ...(row.metadata_json ? { metadata: parseJson<JsonObject>(row.metadata_json) } : {}),
  };
}
}

namespace SessionRepositoryParts {
// Bridges session active-path operations onto the new branch/path-node schema.


type Nullable<T> = T | null;

interface SourceEntryRow {
  entry_id: string;
  session_id: string;
  parent_entry_id: Nullable<string>;
  entry_kind: string;
  message_id: Nullable<string>;
  compaction_id: Nullable<string>;
  target_entry_id: Nullable<string>;
  created_at: string;
  metadata_json: Nullable<string>;
}

interface ActiveBranchRow {
  session_id: string;
  active_entry_id: Nullable<string>;
  updated_at: string;
  metadata_json: Nullable<string>;
}

interface BranchMarkerRow {
  metadata_json: string;
}

interface CompatEventRow {
  event_json: string;
}

type SourceRefLookup = Pick<ModelInputContextSourceRef, 'sourceKind' | 'sourceId'>;

interface SourceEntryMetadata {
  sourceRef?: ModelInputContextSourceRef;
  sourceEntryMetadata?: JsonObject;
  activeLeaf?: SessionActiveLeaf;
  compatBranchMarker?: SessionBranchMarker;
}

interface CompatAuditEvent<T> {
  eventId: string;
  sessionId: string;
  runId: string;
  sequence: number;
  eventType: string;
  visibility: 'internal';
  createdAt: string;
  payload: T;
}

export class SessionActivePathMethods {
  constructor(private readonly database: MegumiDatabase) {}

  appendSourceEntry(entry: SessionSourceEntry): SessionSourceEntry {
    const parsed = SessionSourceEntrySchema.parse(entry);
    if (parsed.parentSourceEntryId) {
      this.assertSourceEntryBelongsToSession(parsed.sessionId, parsed.parentSourceEntryId, 'parentSourceEntryId');
    }

    this.database.prepare(`
      INSERT INTO session_entries (
        entry_id, session_id, parent_entry_id, entry_kind,
        message_id, compaction_id, target_entry_id, created_at, metadata_json
      ) VALUES (
        @entry_id, @session_id, @parent_entry_id, @entry_kind,
        @message_id, NULL, NULL, @created_at, @metadata_json
      )
    `).run({
      entry_id: parsed.sourceEntryId,
      session_id: parsed.sessionId,
      parent_entry_id: parsed.parentSourceEntryId ?? null,
      entry_kind: toDatabaseSourceKind(parsed.sourceRef.sourceKind),
      message_id: parsed.sourceRef.sourceKind === 'session_message' ? parsed.sourceRef.sourceId : null,
      created_at: parsed.createdAt,
      metadata_json: stringifyJson(sourceEntryMetadata(parsed)),
    });

    return parsed;
  }

  appendSourceEntryAndSetActiveLeaf(
    entry: SessionSourceEntry,
    activeLeaf: SessionActiveLeaf,
  ): SessionSourceEntry {
    return this.database.transaction((sourceEntry: SessionSourceEntry, nextActiveLeaf: SessionActiveLeaf) => {
      const appended = this.appendSourceEntry(sourceEntry);
      this.setActiveLeaf(nextActiveLeaf);
      return appended;
    })(entry, activeLeaf);
  }

  getSourceEntry(sourceEntryId: string): SessionSourceEntry | undefined {
    const row = this.database
      .prepare('SELECT * FROM session_entries WHERE entry_id = ?')
      .get(sourceEntryId) as SourceEntryRow | undefined;

    return row ? fromSourceEntryRow(row) : undefined;
  }

  getSourceEntryBySourceRef(
    sessionId: string,
    sourceRef: SourceRefLookup,
  ): SessionSourceEntry | undefined {
    const row = this.database.prepare(`
      SELECT *
      FROM session_entries
      WHERE session_id = ?
        AND (
          (message_id = ? AND ? = 'session_message')
          OR json_extract(metadata_json, '$.sourceRef.sourceKind') = ?
             AND json_extract(metadata_json, '$.sourceRef.sourceId') = ?
        )
      ORDER BY created_at ASC, entry_id ASC
      LIMIT 1
    `).get(
      sessionId,
      sourceRef.sourceId,
      sourceRef.sourceKind,
      sourceRef.sourceKind,
      sourceRef.sourceId,
    ) as SourceEntryRow | undefined;

    return row ? fromSourceEntryRow(row) : undefined;
  }

  listSourceEntriesBySession(sessionId: string): SessionSourceEntry[] {
    return (this.database.prepare(`
      SELECT *
      FROM session_entries
      WHERE session_id = ?
      ORDER BY created_at ASC, entry_id ASC
    `).all(sessionId) as SourceEntryRow[]).map(fromSourceEntryRow);
  }

  setActiveLeaf(activeLeaf: SessionActiveLeaf): SessionActiveLeaf {
    const parsed = SessionActiveLeafSchema.parse(activeLeaf);
    if (parsed.leafSourceEntryId) {
      this.assertSourceEntryBelongsToSession(parsed.sessionId, parsed.leafSourceEntryId, 'leafSourceEntryId');
    }

    ensureSessionDefaultBranch(this.database, {
      sessionId: parsed.sessionId,
      now: parsed.updatedAt,
    });
    const current = this.database.prepare('SELECT active_entry_id FROM sessions WHERE session_id = ?')
      .get(parsed.sessionId) as { active_entry_id: string | null } | undefined;

    this.database.transaction(() => {
      this.database.prepare(`
        UPDATE sessions
        SET active_entry_id = @active_entry_id,
            updated_at = @updated_at,
            metadata_json = json_set(COALESCE(metadata_json, '{}'), '$.activeLeaf', json(@active_leaf_json))
        WHERE session_id = @session_id
      `).run({
        active_entry_id: parsed.leafSourceEntryId ?? null,
        session_id: parsed.sessionId,
        updated_at: parsed.updatedAt,
        active_leaf_json: stringifyJson(parsed),
      });
      this.recordLeafChange(
        parsed.sessionId,
        current?.active_entry_id ?? null,
        parsed.leafSourceEntryId ?? null,
        parsed.reason,
        parsed.updatedAt,
      );
    })();

    return this.getActiveLeaf(parsed.sessionId) ?? parsed;
  }

  getActiveLeaf(sessionId: string): SessionActiveLeaf | undefined {
    const row = this.database.prepare(`
      SELECT s.session_id, s.active_entry_id, s.updated_at, s.metadata_json
      FROM sessions s
      WHERE s.session_id = ?
    `).get(sessionId) as ActiveBranchRow | undefined;

    if (!row) {
      return undefined;
    }

    const metadata = parseOptionalJson<SourceEntryMetadata & { activeLeaf?: SessionActiveLeaf }>(row.metadata_json);
    if (metadata?.activeLeaf) {
      return SessionActiveLeafSchema.parse({
        ...metadata.activeLeaf,
        leafSourceEntryId: row.active_entry_id ?? null,
      });
    }

    return SessionActiveLeafSchema.parse({
      sessionId: row.session_id,
      leafSourceEntryId: row.active_entry_id ?? null,
      updatedAt: row.updated_at,
      reason: row.active_entry_id ? 'source_appended' : 'session_created',
    });
  }

  getActivePath(sessionId: string): SessionActivePath {
    const activeLeaf = this.getActiveLeaf(sessionId);
    if (!activeLeaf?.leafSourceEntryId) {
      return SessionActivePathSchema.parse({ sessionId, entries: [] });
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
      this.assertSourceEntryBelongsToSession(parsed.sessionId, parsed.previousLeafSourceEntryId, 'previousLeafSourceEntryId');
    }
    if (parsed.targetLeafSourceEntryId) {
      this.assertSourceEntryBelongsToSession(parsed.sessionId, parsed.targetLeafSourceEntryId, 'targetLeafSourceEntryId');
    }
    this.assertSourceRefBelongsToSession(parsed.sessionId, parsed.selectedSourceRef, 'selectedSourceRef');
    if (parsed.seedSourceRef) {
      this.assertSourceRefBelongsToSession(parsed.sessionId, parsed.seedSourceRef, 'seedSourceRef');
    }

    this.database.prepare(`
      INSERT INTO session_entries (
        entry_id, session_id, parent_entry_id, entry_kind, message_id,
        compaction_id, target_entry_id, created_at, metadata_json
      ) VALUES (
        @entry_id, @session_id, @parent_entry_id, 'branch_marker', @message_id,
        NULL, @target_entry_id, @created_at, @metadata_json
      )
      ON CONFLICT(entry_id) DO UPDATE SET
        parent_entry_id = excluded.parent_entry_id,
        target_entry_id = excluded.target_entry_id,
        metadata_json = excluded.metadata_json
    `).run({
      entry_id: parsed.branchMarkerId,
      session_id: parsed.sessionId,
      parent_entry_id: parsed.previousLeafSourceEntryId ?? null,
      target_entry_id: parsed.targetLeafSourceEntryId ?? null,
      message_id: parsed.seedSourceRef?.sourceKind === 'session_message'
        ? parsed.seedSourceRef.sourceId
        : null,
      created_at: parsed.createdAt,
      metadata_json: stringifyJson({ compatBranchMarker: parsed }),
    });

    return parsed;
  }

  listBranchMarkersBySession(sessionId: string): SessionBranchMarker[] {
    return (this.database.prepare(`
      SELECT metadata_json
      FROM session_entries
      WHERE session_id = ?
        AND entry_kind = 'branch_marker'
      ORDER BY created_at ASC, entry_id ASC
    `).all(sessionId) as BranchMarkerRow[])
      .map((row) => parseOptionalJson<SourceEntryMetadata>(row.metadata_json)?.compatBranchMarker)
      .filter((marker): marker is SessionBranchMarker => Boolean(marker))
      .map((marker) => SessionBranchMarkerSchema.parse(marker));
  }

  getBranchMarker(branchMarkerId: string): SessionBranchMarker | undefined {
    const row = this.database
      .prepare("SELECT metadata_json FROM session_entries WHERE entry_id = ? AND entry_kind = 'branch_marker'")
      .get(branchMarkerId) as BranchMarkerRow | undefined;
    const marker = row ? parseOptionalJson<SourceEntryMetadata>(row.metadata_json)?.compatBranchMarker : undefined;
    return marker ? SessionBranchMarkerSchema.parse(marker) : undefined;
  }

  listChildSourceEntries(parentSourceEntryId: string): SessionSourceEntry[] {
    return (this.database.prepare(`
      SELECT *
      FROM session_entries
      WHERE parent_entry_id = ?
      ORDER BY created_at ASC, entry_id ASC
    `).all(parentSourceEntryId) as SourceEntryRow[]).map(fromSourceEntryRow);
  }

  saveRetryAttempt(attempt: SessionRetryAttempt): SessionRetryAttempt {
    const parsed = SessionRetryAttemptSchema.parse(attempt);
    const existing = this.getRetryAttempt(parsed.retryAttemptId);
    const persisted = existing ? mergeRetryAttemptUpdate(existing, parsed) : parsed;

    this.assertRunBelongsToSession(persisted.sessionId, persisted.runId, 'runId');
    if (persisted.baseRunId) {
      this.assertRunBelongsToSession(persisted.sessionId, persisted.baseRunId, 'baseRunId');
    }
    if (persisted.baseSourceEntryId) {
      this.assertSourceEntryBelongsToSession(persisted.sessionId, persisted.baseSourceEntryId, 'baseSourceEntryId');
    }

    this.saveSessionPathMetadata({
      pathNodeId: retryAttemptEventId(persisted.retryAttemptId),
      sessionId: persisted.sessionId,
      sourceKind: 'retry_attempt',
      sourceId: persisted.runId,
      createdAt: persisted.createdAt,
      metadata: { retryAttempt: persisted },
    });

    return persisted;
  }

  listRetryAttemptsByRun(runId: string): SessionRetryAttempt[] {
    return (this.database.prepare(`
      SELECT metadata_json
      FROM session_entries
      WHERE entry_kind = 'retry_attempt'
        AND json_extract(metadata_json, '$.retryAttempt.runId') = ?
      ORDER BY created_at ASC, entry_id ASC
    `).all(runId) as Array<{ metadata_json: string | null }>)
      .map((row) => parseOptionalJson<{ retryAttempt?: SessionRetryAttempt }>(row.metadata_json)?.retryAttempt)
      .filter((attempt): attempt is SessionRetryAttempt => Boolean(attempt))
      .map((attempt) => SessionRetryAttemptSchema.parse(attempt));
  }

  recordInterruptedRunMarker(marker: SessionInterruptedRunMarker): SessionInterruptedRunMarker {
    const parsed = SessionInterruptedRunMarkerSchema.parse(marker);
    this.assertRunBelongsToSession(parsed.sessionId, parsed.runId, 'runId');

    this.saveSessionPathMetadata({
      pathNodeId: interruptedMarkerEventId(parsed.interruptedMarkerId),
      sessionId: parsed.sessionId,
      sourceKind: 'interrupted_run_marker',
      sourceId: parsed.runId,
      createdAt: parsed.markedAt,
      metadata: { interruptedRunMarker: parsed },
    });

    return parsed;
  }

  listInterruptedRunMarkersByRun(runId: string): SessionInterruptedRunMarker[] {
    return (this.database.prepare(`
      SELECT metadata_json
      FROM session_entries
      WHERE entry_kind = 'interrupted_run_marker'
        AND json_extract(metadata_json, '$.interruptedRunMarker.runId') = ?
      ORDER BY created_at ASC, entry_id ASC
    `).all(runId) as Array<{ metadata_json: string | null }>)
      .map((row) => parseOptionalJson<{ interruptedRunMarker?: SessionInterruptedRunMarker }>(row.metadata_json)?.interruptedRunMarker)
      .filter((marker): marker is SessionInterruptedRunMarker => Boolean(marker))
      .map((marker) => SessionInterruptedRunMarkerSchema.parse(marker));
  }

  private getRetryAttempt(retryAttemptId: string): SessionRetryAttempt | undefined {
    const row = this.database
      .prepare('SELECT metadata_json FROM session_entries WHERE entry_id = ?')
      .get(retryAttemptEventId(retryAttemptId)) as { metadata_json: string | null } | undefined;

    return row
      ? SessionRetryAttemptSchema.parse(parseOptionalJson<{ retryAttempt?: SessionRetryAttempt }>(row.metadata_json)?.retryAttempt)
      : undefined;
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
    const row = this.database.prepare(`
      SELECT 1 AS found
      FROM session_entries
      WHERE session_id = ?
        AND entry_id = ?
    `).get(sessionId, sourceEntryId) as { found: 1 } | undefined;

    if (!row) {
      throw new Error(`${fieldName} must belong to session ${sessionId}`);
    }
  }

  private assertRunBelongsToSession(sessionId: string, runId: string, fieldName: string): void {
    const row = this.database.prepare(`
      SELECT 1 AS found
      FROM agent_loop_runs
      WHERE session_id = ?
        AND run_id = ?
    `).get(sessionId, runId) as { found: 1 } | undefined;

    if (!row) {
      throw new Error(`${fieldName} must belong to session ${sessionId}`);
    }
  }

  private saveSessionPathMetadata(input: {
    pathNodeId: string;
    sessionId: string;
    sourceKind: string;
    sourceId: string;
    createdAt: string;
    metadata: unknown;
  }): void {
    ensureSessionDefaultBranch(this.database, { sessionId: input.sessionId, now: input.createdAt });
    this.database.prepare(`
      INSERT INTO session_entries (
        entry_id, session_id, parent_entry_id, entry_kind,
        message_id, compaction_id, target_entry_id, created_at, metadata_json
      ) VALUES (
        @entry_id, @session_id, NULL, @entry_kind,
        NULL, NULL, NULL, @created_at, @metadata_json
      )
      ON CONFLICT(entry_id) DO UPDATE SET
        metadata_json = excluded.metadata_json
    `).run({
      entry_id: input.pathNodeId,
      session_id: input.sessionId,
      entry_kind: input.sourceKind,
      created_at: input.createdAt,
      metadata_json: stringifyJson(input.metadata),
    });
  }

  private recordLeafChange(
    sessionId: string,
    previousEntryId: string | null,
    nextEntryId: string | null,
    reason: string,
    createdAt: string,
  ): void {
    this.database.prepare(`
      INSERT INTO session_leaf_changes (
        leaf_change_id, session_id, previous_entry_id, next_entry_id, reason, created_at, metadata_json
      ) VALUES (
        @leaf_change_id, @session_id, @previous_entry_id, @next_entry_id, @reason, @created_at, NULL
      )
    `).run({
      leaf_change_id: `leaf-change:${randomUUID()}`,
      session_id: sessionId,
      previous_entry_id: previousEntryId,
      next_entry_id: nextEntryId,
      reason,
      created_at: createdAt,
    });
  }
}

function mergeRetryAttemptUpdate(existing: SessionRetryAttempt, next: SessionRetryAttempt): SessionRetryAttempt {
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

function sourceEntryMetadata(entry: SessionSourceEntry): SourceEntryMetadata {
  return {
    sourceRef: entry.sourceRef,
    ...(entry.metadata ? { sourceEntryMetadata: entry.metadata } : {}),
  };
}

function fromSourceEntryRow(row: SourceEntryRow): SessionSourceEntry {
  const metadata = parseOptionalJson<SourceEntryMetadata>(row.metadata_json);
  return SessionSourceEntrySchema.parse({
    sourceEntryId: row.entry_id,
    sessionId: row.session_id,
    parentSourceEntryId: row.parent_entry_id ?? undefined,
    sourceRef: metadata?.sourceRef ?? {
      sourceId: row.message_id ?? row.compaction_id ?? row.target_entry_id ?? row.entry_id,
      sourceKind: fromDatabaseSourceKind(row.entry_kind),
    },
    createdAt: row.created_at,
    metadata: metadata?.sourceEntryMetadata,
  });
}

function retryAttemptEventId(retryAttemptId: string): string {
  return `compat:retry-attempt:${retryAttemptId}`;
}

function toDatabaseSourceKind(sourceKind: ModelInputContextSourceRef['sourceKind'] | string): string {
  return sourceKind === 'session_run' ? 'agent_loop_run' : sourceKind;
}

function fromDatabaseSourceKind(sourceKind: string): ModelInputContextSourceRef['sourceKind'] {
  return (sourceKind === 'agent_loop_run' ? 'session_run' : sourceKind) as ModelInputContextSourceRef['sourceKind'];
}

function interruptedMarkerEventId(interruptedMarkerId: string): string {
  return `compat:interrupted-run-marker:${interruptedMarkerId}`;
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}

function parseJson<T = unknown>(value: string): T {
  return JSON.parse(value) as T;
}

function parseOptionalJson<T = unknown>(value: string | null): T | undefined {
  return value ? parseJson<T>(value) : undefined;
}
}

namespace SessionRepositoryParts {
// Owns persisted session compaction summaries for session context history.


type Nullable<T> = T | null;

interface SessionCompactionRow {
  compaction_id: string;
  session_id: string;
  status: SessionCompactionEntry['status'];
  summary_text: string;
  first_kept_entry_id: Nullable<string>;
  token_count_before: Nullable<number>;
  created_at: string;
  metadata_json: Nullable<string>;
}

interface SessionCompactionMetadata {
  firstKeptSourceRef?: SessionCompactionEntry['firstKeptSourceRef'];
  triggerReason?: SessionCompactionEntry['triggerReason'];
  entryMetadata?: SessionCompactionEntry['metadata'];
}

export class SessionCompactionMethods {
  constructor(private readonly database: MegumiDatabase) {}

  saveSessionCompaction(entry: SessionCompactionEntry): void {
    const parsed = SessionCompactionEntrySchema.parse(entry);
    ensureSessionDefaultBranch(this.database, { sessionId: parsed.sessionId, now: parsed.createdAt });

    this.database.prepare(`
      INSERT INTO session_compactions (
        compaction_id, session_id, status, summary_text,
        covered_until_entry_id, first_kept_entry_id, token_count_before,
        token_count_after, created_at, completed_at, error_json, metadata_json
      ) VALUES (
        @compaction_id, @session_id, @status, @summary_text,
        NULL, @first_kept_entry_id, @token_count_before,
        NULL, @created_at, @created_at, NULL, @metadata_json
      )
      ON CONFLICT(compaction_id) DO UPDATE SET
        session_id = excluded.session_id,
        status = excluded.status,
        summary_text = excluded.summary_text,
        first_kept_entry_id = excluded.first_kept_entry_id,
        token_count_before = excluded.token_count_before,
        completed_at = excluded.completed_at,
        metadata_json = excluded.metadata_json
    `).run({
      compaction_id: parsed.compactionId,
      session_id: parsed.sessionId,
      status: parsed.status,
      summary_text: parsed.summary,
      first_kept_entry_id: sourceRefToPathNodeId(parsed.firstKeptSourceRef),
      token_count_before: parsed.tokensBefore,
      created_at: parsed.createdAt,
      metadata_json: stringifyJson({
        firstKeptSourceRef: parsed.firstKeptSourceRef,
        triggerReason: parsed.triggerReason,
        ...(parsed.metadata ? { entryMetadata: parsed.metadata } : {}),
      } satisfies SessionCompactionMetadata),
    });
  }

  getSessionCompaction(compactionId: string): SessionCompactionEntry | null {
    const row = this.database
      .prepare('SELECT * FROM session_compactions WHERE compaction_id = ?')
      .get(compactionId) as SessionCompactionRow | undefined;

    return row ? fromSessionCompactionRow(row) : null;
  }

  listSessionCompactionsBySession(sessionId: string): SessionCompactionEntry[] {
    return (this.database.prepare(`
      SELECT *
      FROM session_compactions
      WHERE session_id = ?
      ORDER BY created_at DESC, compaction_id DESC
    `).all(sessionId) as SessionCompactionRow[]).map(fromSessionCompactionRow);
  }

  getLatestCompletedSessionCompaction(sessionId: string): SessionCompactionEntry | null {
    const row = this.database.prepare(`
      SELECT *
      FROM session_compactions
      WHERE session_id = ?
        AND status = 'completed'
      ORDER BY created_at DESC, compaction_id DESC
      LIMIT 1
    `).get(sessionId) as SessionCompactionRow | undefined;

    return row ? fromSessionCompactionRow(row) : null;
  }
}

function sourceRefToPathNodeId(sourceRef: SessionCompactionEntry['firstKeptSourceRef']): string {
  if (sourceRef.sourceKind === 'session_message') {
    return `message:${sourceRef.sourceId}`;
  }
  if (sourceRef.sourceKind === 'session_run') {
    return `run:${sourceRef.sourceId}`;
  }
  return `${sourceRef.sourceKind}:${sourceRef.sourceId}`;
}

function fromSessionCompactionRow(row: SessionCompactionRow): SessionCompactionEntry {
  const metadata = parseJson<SessionCompactionMetadata>(row.metadata_json) ?? {};
  return SessionCompactionEntrySchema.parse({
    compactionId: row.compaction_id,
    sessionId: row.session_id,
    summary: row.summary_text,
    summaryKind: 'compaction',
    firstKeptSourceRef: metadata.firstKeptSourceRef ?? pathNodeIdToSourceRef(row.first_kept_entry_id),
    tokensBefore: row.token_count_before ?? 0,
    triggerReason: metadata.triggerReason ?? 'context_budget_pressure',
    status: row.status,
    createdAt: row.created_at,
    metadata: metadata.entryMetadata,
  });
}

function pathNodeIdToSourceRef(pathNodeId: string | null): SessionCompactionEntry['firstKeptSourceRef'] {
  const [prefix, ...rest] = (pathNodeId ?? 'other:unknown').split(':');
  const sourceId = rest.join(':') || 'unknown';
  if (prefix === 'message') {
    return { sourceKind: 'session_message', sourceId };
  }
  if (prefix === 'run') {
    return { sourceKind: 'session_run', sourceId };
  }
  return { sourceKind: 'other', sourceId };
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}

function parseJson<T>(value: string | null): T | undefined {
  return value ? JSON.parse(value) as T : undefined;
}
}

namespace SessionRepositoryParts {
// Owns session context persistence transactions that span compactions and active path facts.

export interface SaveSessionCompactionWithActivePathInput {
  compaction: SessionCompactionEntry;
  sourceEntry: SessionSourceEntry;
  activeLeaf: SessionActiveLeaf;
  expectedCurrentLeafSourceEntryId?: string;
}

export interface SaveSessionCompactionWithActivePathResult {
  sourceEntry: SessionSourceEntry;
  activeLeafAdvanced: boolean;
}

export class SessionContextMethods {
  private readonly activePathRepository: SessionRepositoryParts.SessionActivePathMethods;
  private readonly compactionRepository: SessionRepositoryParts.SessionCompactionMethods;

  constructor(private readonly database: MegumiDatabase) {
    this.activePathRepository = new SessionRepositoryParts.SessionActivePathMethods(database);
    this.compactionRepository = new SessionRepositoryParts.SessionCompactionMethods(database);
  }

  saveSessionCompaction(entry: SessionCompactionEntry): void {
    this.compactionRepository.saveSessionCompaction(entry);
  }

  getSessionCompaction(compactionId: string): SessionCompactionEntry | null {
    return this.compactionRepository.getSessionCompaction(compactionId);
  }

  listSessionCompactionsBySession(sessionId: string): SessionCompactionEntry[] {
    return this.compactionRepository.listSessionCompactionsBySession(sessionId);
  }

  getLatestCompletedSessionCompaction(sessionId: string): SessionCompactionEntry | null {
    return this.compactionRepository.getLatestCompletedSessionCompaction(sessionId);
  }

  saveSessionCompactionWithActivePath(
    input: SaveSessionCompactionWithActivePathInput,
  ): SaveSessionCompactionWithActivePathResult {
    const persist = this.database.transaction((
      compaction: SessionCompactionEntry,
      sourceEntry: SessionSourceEntry,
      activeLeaf: SessionActiveLeaf,
      expectedCurrentLeafSourceEntryId: string | undefined,
    ) => {
      this.compactionRepository.saveSessionCompaction(compaction);
      const parsedSourceEntry = this.activePathRepository.appendSourceEntry(sourceEntry);
      const parsedActiveLeaf = SessionActiveLeafSchema.parse(activeLeaf);
      const currentLeaf = this.activePathRepository.getActiveLeaf(parsedActiveLeaf.sessionId);
      const expectedLeaf = expectedCurrentLeafSourceEntryId ?? null;
      let activeLeafAdvanced = false;

      if ((currentLeaf?.leafSourceEntryId ?? null) === expectedLeaf) {
        this.activePathRepository.setActiveLeaf(parsedActiveLeaf);
        activeLeafAdvanced = true;
      }

      return {
        sourceEntry: parsedSourceEntry,
        activeLeafAdvanced,
      };
    });

    return persist(
      input.compaction,
      input.sourceEntry,
      input.activeLeaf,
      input.expectedCurrentLeafSourceEntryId,
    );
  }
}
}


export interface CreateSessionInput {
  sessionId: string;
  workspaceId: string;
  title: string;
  now: string;
  metadataJson?: string | null;
}

export interface AppendUserMessageInput {
  messageId: string;
  sessionId: string;
  contentText: string;
  createdAt: string;
  blocksJson?: string | null;
  metadataJson?: string | null;
  leafChangeReason?: 'user_input_created' | 'retry_input_created' | 'rerun_input_created' | 'recovery_input_created';
}

export interface LinkUserMessageToRunInput {
  messageId: string;
  runId: string;
}

export interface AppendAssistantMessageInput {
  runId: string;
  messageId: string;
  sessionId: string;
  contentText: string;
  completedAt: string;
  blocksJson?: string | null;
  metadataJson?: string | null;
}

export class SessionRepository {
  constructor(private readonly database: MegumiDatabase) {}

  createSession(input: CreateSessionInput): { sessionId: string } {
    return this.database.transaction(() => {
      ensureWorkspace(this.database, { workspaceId: input.workspaceId, now: input.now });

      this.database.prepare(`
        INSERT INTO sessions (
          session_id, workspace_id, title, status, active_entry_id,
          created_at, updated_at, archived_at, metadata_json
        ) VALUES (
          @session_id, @workspace_id, @title, 'active', NULL,
          @now, @now, NULL, @metadata_json
        )
      `).run({
        session_id: input.sessionId,
        workspace_id: input.workspaceId,
        title: input.title,
        now: input.now,
        metadata_json: input.metadataJson ?? null,
      });

      return {
        sessionId: input.sessionId,
      };
    })();
  }

  appendUserMessage(input: AppendUserMessageInput): { messageId: string; entryId: string } {
    return this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO session_messages (
          message_id, session_id, run_id, role, status, content_text,
          blocks_json, created_at, completed_at, metadata_json
        ) VALUES (
          @message_id, @session_id, NULL, 'user', 'completed', @content_text,
          @blocks_json, @created_at, @created_at, @metadata_json
        )
      `).run({
        message_id: input.messageId,
        session_id: input.sessionId,
        content_text: input.contentText,
        blocks_json: input.blocksJson ?? null,
        created_at: input.createdAt,
        metadata_json: input.metadataJson ?? null,
      });

      const entryId = `message:${input.messageId}`;
      this.appendEntryAndSetActive({
        entryId,
        sessionId: input.sessionId,
        entryKind: 'message',
        messageId: input.messageId,
        createdAt: input.createdAt,
        reason: input.leafChangeReason ?? 'user_input_created',
      });

      return {
        messageId: input.messageId,
        entryId,
      };
    })();
  }

  linkUserMessageToRun(input: LinkUserMessageToRunInput): void {
    this.database.prepare(`
      UPDATE session_messages
      SET run_id = @run_id
      WHERE message_id = @message_id
        AND role = 'user'
    `).run({
      run_id: input.runId,
      message_id: input.messageId,
    });
  }

  appendAssistantMessage(input: AppendAssistantMessageInput): { messageId: string; entryId: string } {
    return this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO session_messages (
          message_id, session_id, run_id, role, status, content_text,
          blocks_json, created_at, completed_at, metadata_json
        ) VALUES (
          @message_id, @session_id, @run_id, 'assistant', 'completed', @content_text,
          @blocks_json, @completed_at, @completed_at, @metadata_json
        )
      `).run({
        message_id: input.messageId,
        session_id: input.sessionId,
        run_id: input.runId,
        content_text: input.contentText,
        blocks_json: input.blocksJson ?? null,
        completed_at: input.completedAt,
        metadata_json: input.metadataJson ?? null,
      });

      const entryId = `message:${input.messageId}`;
      this.appendEntryAndSetActive({
        entryId,
        sessionId: input.sessionId,
        entryKind: 'message',
        messageId: input.messageId,
        createdAt: input.completedAt,
        reason: 'assistant_reply_created',
      });

      return {
        messageId: input.messageId,
        entryId,
      };
    })();
  }

  private appendEntryAndSetActive(input: {
    entryId: string;
    sessionId: string;
    entryKind: string;
    createdAt: string;
    reason: string;
    messageId?: string | null;
    compactionId?: string | null;
    targetEntryId?: string | null;
    metadataJson?: string | null;
  }): void {
    const current = this.database.prepare('SELECT active_entry_id FROM sessions WHERE session_id = ?')
      .get(input.sessionId) as { active_entry_id: string | null } | undefined;
    if (!current) {
      throw new Error(`Session ${input.sessionId} does not exist`);
    }

    this.database.prepare(`
      INSERT INTO session_entries (
        entry_id, session_id, parent_entry_id, entry_kind, message_id,
        compaction_id, target_entry_id, created_at, metadata_json
      ) VALUES (
        @entry_id, @session_id, @parent_entry_id, @entry_kind, @message_id,
        @compaction_id, @target_entry_id, @created_at, @metadata_json
      )
      ON CONFLICT(entry_id) DO UPDATE SET
        metadata_json = excluded.metadata_json
    `).run({
      entry_id: input.entryId,
      session_id: input.sessionId,
      parent_entry_id: current.active_entry_id,
      entry_kind: input.entryKind,
      message_id: input.messageId ?? null,
      compaction_id: input.compactionId ?? null,
      target_entry_id: input.targetEntryId ?? null,
      created_at: input.createdAt,
      metadata_json: input.metadataJson ?? null,
    });

    this.database.prepare(`
      INSERT INTO session_leaf_changes (
        leaf_change_id, session_id, previous_entry_id, next_entry_id, reason, created_at, metadata_json
      ) VALUES (
        @leaf_change_id, @session_id, @previous_entry_id, @next_entry_id, @reason, @created_at, NULL
      )
    `).run({
      leaf_change_id: `${input.entryId}:leaf-change`,
      session_id: input.sessionId,
      previous_entry_id: current.active_entry_id,
      next_entry_id: input.entryId,
      reason: input.reason,
      created_at: input.createdAt,
    });

    this.database.prepare(`
      UPDATE sessions
      SET active_entry_id = @active_entry_id,
          updated_at = @updated_at
      WHERE session_id = @session_id
    `).run({
      active_entry_id: input.entryId,
      updated_at: input.createdAt,
      session_id: input.sessionId,
    });
  }
}

export interface SessionRepository
  extends Pick<SessionRepositoryParts.SessionRecordMethods, keyof SessionRepositoryParts.SessionRecordMethods>,
    Pick<SessionRepositoryParts.SessionMessageMethods, keyof SessionRepositoryParts.SessionMessageMethods>,
    Pick<SessionRepositoryParts.SessionActivePathMethods, keyof SessionRepositoryParts.SessionActivePathMethods>,
    Pick<SessionRepositoryParts.SessionCompactionMethods, keyof SessionRepositoryParts.SessionCompactionMethods>,
    Pick<SessionRepositoryParts.SessionContextMethods, keyof SessionRepositoryParts.SessionContextMethods> {}

copyRepositoryMethods(SessionRepository, [
  SessionRepositoryParts.SessionRecordMethods,
  SessionRepositoryParts.SessionMessageMethods,
  SessionRepositoryParts.SessionActivePathMethods,
  SessionRepositoryParts.SessionCompactionMethods,
  SessionRepositoryParts.SessionContextMethods,
]);

function copyRepositoryMethods(
  target: { prototype: object },
  sources: Array<{ prototype: object }>,
): void {
  for (const source of sources) {
    for (const name of Object.getOwnPropertyNames(source.prototype)) {
      if (name === 'constructor' || name in target.prototype) {
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(source.prototype, name);
      if (descriptor) {
        Object.defineProperty(target.prototype, name, descriptor);
      }
    }
  }
}


