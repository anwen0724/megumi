// Implements the session repository port using SQLite rows without owning session rules.
import type { JsonObject, JsonValue } from '../../shared';
import {
  BranchMarkerSchema,
  RetryAttemptSchema,
  SessionMessageSchema,
  SessionRunRecordSchema,
  SessionSchema,
  SessionSourceEntrySchema,
  type BranchMarker,
  type RetryAttempt,
  type Session,
  type SessionMessage,
  type SessionRunRecord,
  type SessionSourceEntry,
  type SessionStateRepository,
} from '../../session';
import type {
  BranchMarkerId,
  RetryAttemptId,
  SessionId,
  SessionMessageId,
  SessionRunId,
  SessionSourceEntryId,
} from '../../session';
import type { SessionSourceRef } from '../../session';
import type { SqliteDatabase } from '../connection';
import { RowMappingError } from '../errors';
import { decodeJsonField, encodeJson } from '../json';
import { runInTransaction } from '../transaction';

interface SessionRow {
  id: string;
  title: string;
  status: Session['status'];
  workspace_id: string | null;
  workspace_path: string | null;
  created_at: string;
  updated_at: string;
  metadata_json: string | null;
}

interface MessageRow {
  id: string;
  session_id: string;
  role: SessionMessage['role'];
  content_json: string;
  created_at: string;
  metadata_json: string | null;
}

interface SourceEntryRow {
  id: string;
  session_id: string;
  parent_id: string | null;
  kind: SessionSourceEntry['kind'];
  ref_json: string;
  created_at: string;
  metadata_json: string | null;
}

interface BranchMarkerRow {
  id: string;
  session_id: string;
  source_entry_id: string;
  from_source_entry_id: string;
  label: string | null;
  created_at: string;
  metadata_json: string | null;
}

interface RetryAttemptRow {
  id: string;
  session_id: string;
  source_entry_id: string;
  target_source_entry_id: string;
  mode: RetryAttempt['mode'];
  attempt_number: number;
  created_at: string;
  metadata_json: string | null;
}

interface RunRow {
  id: string;
  session_id: string;
  source_entry_id: string;
  input_summary: string;
  status: SessionRunRecord['status'];
  started_at: string;
  ended_at: string | null;
  error_json: string | null;
  metadata_json: string | null;
}

export class SqliteSessionStateRepository implements SessionStateRepository {
  constructor(private readonly database: SqliteDatabase) {}

  transaction<T>(work: () => T): T {
    return runInTransaction(this.database, work);
  }

  createSession(session: Session): Session {
    this.database
      .prepare(
        `
        INSERT INTO sessions (id, title, status, workspace_id, workspace_path, created_at, updated_at, metadata_json)
        VALUES (@id, @title, @status, @workspaceId, @workspacePath, @createdAt, @updatedAt, @metadataJson)
      `,
      )
      .run({
        id: session.id,
        title: session.title,
        status: session.status,
        workspaceId: session.workspaceId ?? null,
        workspacePath: session.workspacePath ?? null,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        metadataJson: encodeJson(session.metadata),
      });

    return session;
  }

  getSession(sessionId: SessionId | string): Session | undefined {
    const row = this.database.prepare('SELECT * FROM sessions WHERE id = ?').get(String(sessionId)) as
      | SessionRow
      | undefined;
    return row ? mapSession(row) : undefined;
  }

  listSessions(): Session[] {
    return (this.database.prepare('SELECT * FROM sessions ORDER BY created_at ASC').all() as SessionRow[]).map(
      mapSession,
    );
  }

  insertMessage(message: SessionMessage): SessionMessage {
    this.database
      .prepare(
        `
        INSERT INTO session_messages (id, session_id, role, content_json, created_at, metadata_json)
        VALUES (@id, @sessionId, @role, @contentJson, @createdAt, @metadataJson)
      `,
      )
      .run({
        id: message.id,
        sessionId: message.sessionId,
        role: message.role,
        contentJson: encodeJson(message.content),
        createdAt: message.createdAt,
        metadataJson: encodeJson(message.metadata),
      });
    return message;
  }

  getMessage(messageId: SessionMessageId | string): SessionMessage | undefined {
    const row = this.database.prepare('SELECT * FROM session_messages WHERE id = ?').get(String(messageId)) as
      | MessageRow
      | undefined;
    return row ? mapMessage(row) : undefined;
  }

  listMessagesForSession(sessionId: SessionId | string): SessionMessage[] {
    return (
      this.database
        .prepare('SELECT * FROM session_messages WHERE session_id = ? ORDER BY created_at ASC')
        .all(String(sessionId)) as MessageRow[]
    ).map(mapMessage);
  }

  getMessagesForPath(path: SessionSourceEntry[]): SessionMessage[] {
    const messageIds = path.flatMap((entry) => {
      if (entry.kind !== 'message' || entry.ref.type !== 'message') {
        return [];
      }

      return [String(entry.ref.messageId)];
    });

    if (messageIds.length === 0) {
      return [];
    }

    const messages = new Map(messageIds.map((messageId) => [messageId, this.getMessage(messageId)]));
    return messageIds.flatMap((messageId) => {
      const message = messages.get(messageId);
      return message ? [message] : [];
    });
  }

  insertSourceEntry(entry: SessionSourceEntry): SessionSourceEntry {
    this.database
      .prepare(
        `
        INSERT INTO session_source_entries (id, session_id, parent_id, kind, ref_json, created_at, metadata_json)
        VALUES (@id, @sessionId, @parentId, @kind, @refJson, @createdAt, @metadataJson)
      `,
      )
      .run({
        id: entry.id,
        sessionId: entry.sessionId,
        parentId: entry.parentId ?? null,
        kind: entry.kind,
        refJson: encodeJson(entry.ref),
        createdAt: entry.createdAt,
        metadataJson: encodeJson(entry.metadata),
      });
    return entry;
  }

  getSourceEntry(sourceEntryId: SessionSourceEntryId | string): SessionSourceEntry | undefined {
    const row = this.database.prepare('SELECT * FROM session_source_entries WHERE id = ?').get(String(sourceEntryId)) as
      | SourceEntryRow
      | undefined;
    return row ? mapSourceEntry(row) : undefined;
  }

  getActiveLeaf(sessionId: SessionId | string): SessionSourceEntry | undefined {
    const row = this.database
      .prepare(
        `
        SELECT e.*
        FROM session_active_leaves active
        JOIN session_source_entries e ON e.id = active.source_entry_id
        WHERE active.session_id = ?
      `,
      )
      .get(String(sessionId)) as SourceEntryRow | undefined;
    return row ? mapSourceEntry(row) : undefined;
  }

  setActiveLeaf(sessionId: SessionId | string, sourceEntryId: SessionSourceEntryId | string): void {
    this.database
      .prepare(
        `
        INSERT INTO session_active_leaves (session_id, source_entry_id, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          source_entry_id = excluded.source_entry_id,
          updated_at = excluded.updated_at
      `,
      )
      .run(String(sessionId), String(sourceEntryId), new Date().toISOString());
  }

  getActivePath(sessionId: SessionId | string): SessionSourceEntry[] {
    const activeLeaf = this.getActiveLeaf(sessionId);
    if (!activeLeaf) {
      return [];
    }

    const entries: SessionSourceEntry[] = [];
    let current: SessionSourceEntry | undefined = activeLeaf;

    while (current) {
      entries.push(current);
      current = current.parentId ? this.getSourceEntry(current.parentId) : undefined;
    }

    return entries.reverse();
  }

  insertBranchMarker(marker: BranchMarker): BranchMarker {
    this.database
      .prepare(
        `
        INSERT INTO branch_markers (
          id, session_id, source_entry_id, from_source_entry_id, label, created_at, metadata_json
        )
        VALUES (@id, @sessionId, @sourceEntryId, @fromSourceEntryId, @label, @createdAt, @metadataJson)
      `,
      )
      .run({
        id: marker.id,
        sessionId: marker.sessionId,
        sourceEntryId: marker.sourceEntryId,
        fromSourceEntryId: marker.fromSourceEntryId,
        label: marker.label ?? null,
        createdAt: marker.createdAt,
        metadataJson: encodeJson(marker.metadata),
      });
    return marker;
  }

  listBranchMarkers(sessionId: SessionId | string): BranchMarker[] {
    return (
      this.database
        .prepare('SELECT * FROM branch_markers WHERE session_id = ? ORDER BY created_at ASC')
        .all(String(sessionId)) as BranchMarkerRow[]
    ).map(mapBranchMarker);
  }

  insertRetryAttempt(attempt: RetryAttempt): RetryAttempt {
    this.database
      .prepare(
        `
        INSERT INTO retry_attempts (
          id, session_id, source_entry_id, target_source_entry_id, mode, attempt_number, created_at, metadata_json
        )
        VALUES (
          @id, @sessionId, @sourceEntryId, @targetSourceEntryId, @mode, @attemptNumber, @createdAt, @metadataJson
        )
      `,
      )
      .run({
        id: attempt.id,
        sessionId: attempt.sessionId,
        sourceEntryId: attempt.sourceEntryId,
        targetSourceEntryId: attempt.targetSourceEntryId,
        mode: attempt.mode,
        attemptNumber: attempt.attemptNumber,
        createdAt: attempt.createdAt,
        metadataJson: encodeJson(attempt.metadata),
      });
    return attempt;
  }

  listRetryAttempts(sessionId: SessionId | string): RetryAttempt[] {
    return (
      this.database
        .prepare('SELECT * FROM retry_attempts WHERE session_id = ? ORDER BY created_at ASC')
        .all(String(sessionId)) as RetryAttemptRow[]
    ).map(mapRetryAttempt);
  }

  insertRunRecord(run: SessionRunRecord): SessionRunRecord {
    this.database
      .prepare(
        `
        INSERT INTO session_runs (
          id, session_id, source_entry_id, input_summary, status, started_at, ended_at, error_json, metadata_json
        )
        VALUES (
          @id, @sessionId, @sourceEntryId, @inputSummary, @status, @startedAt, @endedAt, @errorJson, @metadataJson
        )
      `,
      )
      .run({
        id: run.id,
        sessionId: run.sessionId,
        sourceEntryId: run.sourceEntryId,
        inputSummary: run.inputSummary,
        status: run.status,
        startedAt: run.startedAt,
        endedAt: run.endedAt ?? null,
        errorJson: encodeJson(run.error),
        metadataJson: encodeJson(run.metadata),
      });
    return run;
  }

  updateRunRecord(run: SessionRunRecord): SessionRunRecord {
    this.database
      .prepare(
        `
        UPDATE session_runs
        SET status = @status,
            ended_at = @endedAt,
            error_json = @errorJson,
            metadata_json = @metadataJson
        WHERE id = @id
      `,
      )
      .run({
        id: run.id,
        status: run.status,
        endedAt: run.endedAt ?? null,
        errorJson: encodeJson(run.error),
        metadataJson: encodeJson(run.metadata),
      });
    return run;
  }

  getRunRecord(runId: SessionRunId | string): SessionRunRecord | undefined {
    const row = this.database.prepare('SELECT * FROM session_runs WHERE id = ?').get(String(runId)) as
      | RunRow
      | undefined;
    return row ? mapRun(row) : undefined;
  }

  listRunRecords(sessionId: SessionId | string): SessionRunRecord[] {
    return (
      this.database
        .prepare('SELECT * FROM session_runs WHERE session_id = ? ORDER BY started_at ASC')
        .all(String(sessionId)) as RunRow[]
    ).map(mapRun);
  }
}

function mapSession(row: SessionRow): Session {
  return parseMapped({
    table: 'sessions',
    rowId: row.id,
    schema: SessionSchema,
    value: {
      id: row.id,
      title: row.title,
      status: row.status,
      workspaceId: row.workspace_id ?? undefined,
      workspacePath: row.workspace_path ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      metadata: decodeJsonField<JsonObject>({
        value: row.metadata_json,
        table: 'sessions',
        column: 'metadata_json',
        rowId: row.id,
      }),
    },
  }) as Session;
}

function mapMessage(row: MessageRow): SessionMessage {
  return parseMapped({
    table: 'session_messages',
    rowId: row.id,
    schema: SessionMessageSchema,
    value: {
      id: row.id,
      sessionId: row.session_id,
      role: row.role,
      content: decodeJsonField<JsonValue>({
        value: row.content_json,
        table: 'session_messages',
        column: 'content_json',
        rowId: row.id,
      }),
      createdAt: row.created_at,
      metadata: decodeJsonField<JsonObject>({
        value: row.metadata_json,
        table: 'session_messages',
        column: 'metadata_json',
        rowId: row.id,
      }),
    },
  }) as SessionMessage;
}

function mapSourceEntry(row: SourceEntryRow): SessionSourceEntry {
  return parseMapped({
    table: 'session_source_entries',
    rowId: row.id,
    schema: SessionSourceEntrySchema,
    value: {
      id: row.id,
      sessionId: row.session_id,
      parentId: row.parent_id ?? undefined,
      kind: row.kind,
      ref: decodeJsonField<SessionSourceRef>({
        value: row.ref_json,
        table: 'session_source_entries',
        column: 'ref_json',
        rowId: row.id,
      }),
      createdAt: row.created_at,
      metadata: decodeJsonField<JsonObject>({
        value: row.metadata_json,
        table: 'session_source_entries',
        column: 'metadata_json',
        rowId: row.id,
      }),
    },
  }) as SessionSourceEntry;
}

function mapBranchMarker(row: BranchMarkerRow): BranchMarker {
  return parseMapped({
    table: 'branch_markers',
    rowId: row.id,
    schema: BranchMarkerSchema,
    value: {
      id: row.id,
      sessionId: row.session_id,
      sourceEntryId: row.source_entry_id,
      fromSourceEntryId: row.from_source_entry_id,
      label: row.label ?? undefined,
      createdAt: row.created_at,
      metadata: decodeJsonField<JsonObject>({
        value: row.metadata_json,
        table: 'branch_markers',
        column: 'metadata_json',
        rowId: row.id,
      }),
    },
  }) as BranchMarker;
}

function mapRetryAttempt(row: RetryAttemptRow): RetryAttempt {
  return parseMapped({
    table: 'retry_attempts',
    rowId: row.id,
    schema: RetryAttemptSchema,
    value: {
      id: row.id,
      sessionId: row.session_id,
      sourceEntryId: row.source_entry_id,
      targetSourceEntryId: row.target_source_entry_id,
      mode: row.mode,
      attemptNumber: row.attempt_number,
      createdAt: row.created_at,
      metadata: decodeJsonField<JsonObject>({
        value: row.metadata_json,
        table: 'retry_attempts',
        column: 'metadata_json',
        rowId: row.id,
      }),
    },
  }) as RetryAttempt;
}

function mapRun(row: RunRow): SessionRunRecord {
  return parseMapped({
    table: 'session_runs',
    rowId: row.id,
    schema: SessionRunRecordSchema,
    value: {
      id: row.id,
      sessionId: row.session_id,
      sourceEntryId: row.source_entry_id,
      inputSummary: row.input_summary,
      status: row.status,
      startedAt: row.started_at,
      endedAt: row.ended_at ?? undefined,
      error: decodeJsonField<JsonObject>({
        value: row.error_json,
        table: 'session_runs',
        column: 'error_json',
        rowId: row.id,
      }),
      metadata: decodeJsonField<JsonObject>({
        value: row.metadata_json,
        table: 'session_runs',
        column: 'metadata_json',
        rowId: row.id,
      }),
    },
  }) as SessionRunRecord;
}

function parseMapped<T>(input: {
  table: string;
  rowId: string;
  schema: { parse(value: unknown): T };
  value: unknown;
}): T {
  try {
    return input.schema.parse(input.value);
  } catch (error) {
    throw new RowMappingError(`Row mapping failed for ${input.table} row ${input.rowId}`, {
      table: input.table,
      rowId: input.rowId,
      cause: error,
    });
  }
}
