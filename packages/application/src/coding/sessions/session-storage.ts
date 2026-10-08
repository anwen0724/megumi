/* Persists Coding session records and managed attachments using existing storage. */
import path from 'node:path';
import type { DatabaseConnection, DatabaseRow } from '../../storage/index';
import type { SessionCompactionRecord } from '../compact-history';
import type { SessionAttachmentContentStore, SessionAttachmentFileSystem, SessionMessageAttachment, SupportedSessionImageMediaType } from './session-attachments';
import type { SessionCompactionSummary, SessionEntry } from './session-branches';
import type { Session } from './session-catalog';
import { SessionModelSelectionSchema } from './session-catalog';
import type { SessionAssistantContent, SessionAssistantReplyMessage, SessionMessage, SessionMessageKind, UserMessage } from './session-history';
import { normalizeLegacyAssistantContent, normalizeLegacyUserMessagePayload, SessionAssistantReplyMessageSchema, SessionAssistantReplyPayloadSchema, SessionModelResponsePayloadSchema, SessionToolResultPayloadSchema, SessionUserMessagePayloadSchema, SessionUserMessageSchema } from './session-history';

export interface SessionStore {
  runInTransaction<T>(operation: () => T): T;

  insertSession(session: Session): Session;
  updateSessionModelSelection(input: {
    session_id: string;
    model_selection: NonNullable<Session['model_selection']>;
    updated_at: string;
  }): Session | undefined;
  findSessionById(sessionId: string): Session | undefined;
  listSessionsByWorkspaceId(workspaceId: string): Session[];
  listSourceSessions(request?: { sessionId?: string; limit?: number }): { session: Session; contentUpdatedAt: string }[];
  getReplyCursor(): number;
  listRepliesAfter(cursor: number, limit: number): { cursor: number; message: SessionAssistantReplyMessage }[];
  archiveSession(input: { session_id: string; archived_at: string }): Session | undefined;
  updateSessionActiveEntry(input: {
    session_id: string;
    active_entry_id?: string;
    updated_at: string;
  }): Session | undefined;

  insertMessage(message: SessionMessage): SessionMessage;
  findMessageById(messageId: string): SessionMessage | undefined;
  listMessagesBySessionId(sessionId: string): SessionMessage[];
  findAssistantReplyBySessionIdAndExecutionId(input: {
    session_id: string;
    execution_id: string;
  }): SessionAssistantReplyMessage | undefined;
  listUserMessagesByExecutionIds(executionIds: string[]): UserMessage[];
  listMessagesByIds(messageIds: string[]): SessionMessage[];

  insertMessageAttachments(attachments: SessionMessageAttachment[]): void;
  findAttachmentById(attachmentId: string): SessionMessageAttachment | undefined;
  listAttachmentsByMessageIds(messageIds: string[]): SessionMessageAttachment[];

  insertEntry(entry: SessionEntry): SessionEntry;
  findEntryById(entryId: string): SessionEntry | undefined;
  findMessageEntryBySessionIdAndMessageId(input: {
    session_id: string;
    message_id: string;
  }): SessionEntry | undefined;
  listEntriesBySessionId(sessionId: string): SessionEntry[];
  updateEntryParent(input: {
    entry_id: string;
    parent_entry_id?: string;
  }): SessionEntry | undefined;

  insertCompaction(compaction: SessionCompactionRecord): SessionCompactionRecord;
  updateCompaction(compaction: SessionCompactionRecord): SessionCompactionRecord | undefined;
  findCompactionById(compactionId: string): SessionCompactionRecord | undefined;
  listCompactionsBySessionId(sessionId: string): SessionCompactionRecord[];
  listRunningCompactions(): SessionCompactionRecord[];
  listCompletedCompactionSummariesByIds(compactionIds: string[]): SessionCompactionSummary[];
}

type Nullable<T> = T | null;

/** Creates a Session store over the application-owned database connection. */
export function createSessionStore(input: { database: DatabaseConnection }): SessionStore {
  return new DatabaseSessionStore(input.database);
}

class DatabaseSessionStore implements SessionStore {
  constructor(private readonly database: DatabaseConnection) {}

  runInTransaction<T>(operation: () => T): T {
    return this.database.transaction({ operation });
  }

  insertSession(session: Session): Session {
    this.database
      .prepare({
        sql: `
      INSERT INTO sessions (
        session_id, workspace_id, title, status, active_entry_id,
        created_at, updated_at, archived_at, model_selection, content_updated_at
      ) VALUES (
        @session_id, @workspace_id, @title, @status, @active_entry_id,
        @created_at, @updated_at, @archived_at, @model_selection, @created_at
      )
    `,
      })
      .run(toSessionRow(session));
    return session;
  }

  findSessionById(sessionId: string): Session | undefined {
    const row = this.database
      .prepare<SessionRow>({
        sql: 'SELECT * FROM sessions WHERE session_id = ?',
      })
      .get([sessionId]);
    return row ? fromSessionRow(row) : undefined;
  }

  updateSessionModelSelection(input: {
    session_id: string;
    model_selection: NonNullable<Session['model_selection']>;
    updated_at: string;
  }): Session | undefined {
    this.database
      .prepare({
        sql: 'UPDATE sessions SET model_selection = @model_selection, updated_at = @updated_at WHERE session_id = @session_id',
      })
      .run({ ...input, model_selection: JSON.stringify(input.model_selection) });
    return this.findSessionById(input.session_id);
  }

  listSessionsByWorkspaceId(workspaceId: string): Session[] {
    return this.database
      .prepare<SessionRow>({
        sql: `
      SELECT * FROM sessions
      WHERE workspace_id = ?
      ORDER BY updated_at DESC
    `,
      })
      .all([workspaceId])
      .map(fromSessionRow);
  }

  archiveSession(input: { session_id: string; archived_at: string }): Session | undefined {
    this.database
      .prepare({
        sql: `
      UPDATE sessions
      SET status = 'archived',
          archived_at = @archived_at,
          updated_at = @archived_at
      WHERE session_id = @session_id
    `,
      })
      .run(input);
    return this.findSessionById(input.session_id);
  }

  updateSessionActiveEntry(input: {
    session_id: string;
    active_entry_id?: string;
    updated_at: string;
  }): Session | undefined {
    const previous = this.findSessionById(input.session_id);
    const contentChanged = this.originalTip(previous?.active_entry_id) !== this.originalTip(input.active_entry_id);
    this.database
      .prepare({
        sql: `
      UPDATE sessions
      SET active_entry_id = @active_entry_id,
          content_updated_at = CASE WHEN @content_changed THEN @updated_at ELSE content_updated_at END,
          updated_at = @updated_at
      WHERE session_id = @session_id
    `,
      })
      .run({
        session_id: input.session_id,
        active_entry_id: input.active_entry_id ?? null,
        updated_at: input.updated_at,
        content_changed: contentChanged ? 1 : 0,
      });
    return this.findSessionById(input.session_id);
  }

  private originalTip(entryId?: string): string | undefined {
    const visited = new Set<string>();
    while (entryId) {
      if (visited.has(entryId)) throw new Error('Cycle in session compaction chain.');
      visited.add(entryId);
      const entry = this.findEntryById(entryId);
      if (!entry || entry.entry_type === 'message') return entryId;
      const summary = entry.compaction_id ? this.findCompactionById(entry.compaction_id)?.summary : undefined;
      if (!summary) throw new Error(`Missing compaction summary for ${entryId}.`);
      entryId = summary.covered_until_entry_id;
    }
    return undefined;
  }

  listSourceSessions(request: { sessionId?: string; limit?: number } = {}): { session: Session; contentUpdatedAt: string }[] {
    const { sessionId, limit } = request;
    return this.database.prepare<SessionRow & { content_updated_at: string | null }>({
      sql: `SELECT * FROM sessions ${sessionId ? 'WHERE session_id = ?' : ''}
        ORDER BY COALESCE(content_updated_at, created_at) DESC, session_id DESC ${limit === undefined ? '' : 'LIMIT ?'}`,
    }).all([...(sessionId ? [sessionId] : []), ...(limit === undefined ? [] : [limit])]).map(row => ({
      session: fromSessionRow(row), contentUpdatedAt: row.content_updated_at ?? row.created_at,
    }));
  }

  getReplyCursor(): number {
    return this.database.prepare<{ seq: number }>({
      sql: "SELECT seq FROM sqlite_sequence WHERE name = 'session_reply_sequence'",
    }).get()?.seq ?? 0;
  }

  listRepliesAfter(cursor: number, limit: number): { cursor: number; message: SessionAssistantReplyMessage }[] {
    return this.database.prepare<SessionMessageRow & { sequence: number }>({
      sql: `SELECT m.*, r.sequence FROM session_reply_sequence r
        JOIN session_messages m ON m.message_id = r.message_id
        WHERE r.sequence > ? ORDER BY r.sequence ASC LIMIT ?`,
    }).all([cursor, limit]).map(row => ({ cursor: row.sequence,
      message: SessionAssistantReplyMessageSchema.parse(fromMessageRow(row)) }));
  }

  insertMessage(message: SessionMessage): SessionMessage {
    this.database
      .prepare({
        sql: `
      INSERT INTO session_messages (
        message_id, session_id, execution_id, message_kind, message_json,
        created_at, completed_at
      ) VALUES (
        @message_id, @session_id, @execution_id, @message_kind, @message_json,
        @created_at, @completed_at
      )
    `,
      })
      .run(toMessageRow(message));
    return message;
  }

  findMessageById(messageId: string): SessionMessage | undefined {
    const row = this.database
      .prepare<SessionMessageRow>({
        sql: 'SELECT * FROM session_messages WHERE message_id = ?',
      })
      .get([messageId]);
    return row ? fromMessageRow(row) : undefined;
  }

  listMessagesBySessionId(sessionId: string): SessionMessage[] {
    return this.database
      .prepare<SessionMessageRow>({
        sql: `
      SELECT * FROM session_messages
      WHERE session_id = ?
      ORDER BY created_at ASC, message_id ASC
    `,
      })
      .all([sessionId])
      .map(fromMessageRow);
  }

  findAssistantReplyBySessionIdAndExecutionId(input: {
    session_id: string;
    execution_id: string;
  }): SessionAssistantReplyMessage | undefined {
    const row = this.database
      .prepare<SessionMessageRow>({
        sql: `
      SELECT * FROM session_messages
      WHERE session_id = @session_id
        AND execution_id = @execution_id
        AND message_kind = 'assistant_reply'
      LIMIT 1
    `,
      })
      .get(input);
    return row ? SessionAssistantReplyMessageSchema.parse(fromMessageRow(row)) : undefined;
  }

  listUserMessagesByExecutionIds(executionIds: string[]): UserMessage[] {
    if (executionIds.length === 0) return [];
    const placeholders = executionIds.map(() => '?').join(', ');
    return this.database
      .prepare<SessionMessageRow>({
        sql: `
      SELECT * FROM session_messages
      WHERE execution_id IN (${placeholders}) AND message_kind = 'user_message'
      ORDER BY created_at ASC, message_id ASC
    `,
      })
      .all(executionIds)
      .map((row) => SessionUserMessageSchema.parse(fromMessageRow(row)));
  }

  listMessagesByIds(messageIds: string[]): SessionMessage[] {
    if (messageIds.length === 0) return [];
    const placeholders = messageIds.map(() => '?').join(', ');
    return this.database
      .prepare<SessionMessageRow>({
        sql: `
      SELECT * FROM session_messages
      WHERE message_id IN (${placeholders})
    `,
      })
      .all(messageIds)
      .map(fromMessageRow);
  }

  insertMessageAttachments(attachments: SessionMessageAttachment[]): void {
    const insert = this.database.prepare({
      sql: `
      INSERT INTO session_message_attachments (
        attachment_id, message_id, session_id, type, name, mime_type,
        source_type, source_value, created_at, ordinal, size_bytes
      ) VALUES (
        @attachment_id, @message_id, @session_id, @type, @name, @mime_type,
        @source_type, @source_value, @created_at, @ordinal, @size_bytes
      )
    `,
    });
    for (const attachment of attachments) insert.run(toAttachmentRow(attachment));
  }

  findAttachmentById(attachmentId: string): SessionMessageAttachment | undefined {
    const row = this.database
      .prepare<SessionMessageAttachmentRow>({
        sql: 'SELECT * FROM session_message_attachments WHERE attachment_id = ?',
      })
      .get([attachmentId]);
    return row ? fromAttachmentRow(row) : undefined;
  }

  listAttachmentsByMessageIds(messageIds: string[]): SessionMessageAttachment[] {
    if (messageIds.length === 0) return [];
    const placeholders = messageIds.map(() => '?').join(', ');
    return this.database
      .prepare<SessionMessageAttachmentRow>({
        sql: `
      SELECT * FROM session_message_attachments
      WHERE message_id IN (${placeholders})
      ORDER BY message_id ASC, ordinal ASC
    `,
      })
      .all(messageIds)
      .map(fromAttachmentRow);
  }

  insertEntry(entry: SessionEntry): SessionEntry {
    this.database
      .prepare({
        sql: `
      INSERT INTO session_entries (
        entry_id, session_id, parent_entry_id, entry_type,
        message_id, compaction_id, created_at
      ) VALUES (
        @entry_id, @session_id, @parent_entry_id, @entry_type,
        @message_id, @compaction_id, @created_at
      )
    `,
      })
      .run(toEntryRow(entry));
    return entry;
  }

  findEntryById(entryId: string): SessionEntry | undefined {
    const row = this.database
      .prepare<SessionEntryRow>({
        sql: 'SELECT * FROM session_entries WHERE entry_id = ?',
      })
      .get([entryId]);
    return row ? fromEntryRow(row) : undefined;
  }

  findMessageEntryBySessionIdAndMessageId(input: {
    session_id: string;
    message_id: string;
  }): SessionEntry | undefined {
    const row = this.database
      .prepare<SessionEntryRow>({
        sql: `
      SELECT * FROM session_entries
      WHERE session_id = @session_id
        AND message_id = @message_id
        AND entry_type = 'message'
    `,
      })
      .get(input);
    return row ? fromEntryRow(row) : undefined;
  }

  listEntriesBySessionId(sessionId: string): SessionEntry[] {
    return this.database
      .prepare<SessionEntryRow>({
        sql: `
      SELECT * FROM session_entries
      WHERE session_id = ?
      ORDER BY created_at ASC, entry_id ASC
    `,
      })
      .all([sessionId])
      .map(fromEntryRow);
  }

  updateEntryParent(input: {
    entry_id: string;
    parent_entry_id?: string;
  }): SessionEntry | undefined {
    this.database
      .prepare({
        sql: `
      UPDATE session_entries
      SET parent_entry_id = @parent_entry_id
      WHERE entry_id = @entry_id
    `,
      })
      .run({
        entry_id: input.entry_id,
        parent_entry_id: input.parent_entry_id ?? null,
      });
    return this.findEntryById(input.entry_id);
  }

  /** Inserts the unique Session-owned lifecycle record. */
  insertCompaction(compaction: SessionCompactionRecord): SessionCompactionRecord {
    this.database
      .prepare({
        sql: `
      INSERT INTO session_compactions (
        compaction_id, session_id, anchor_entry_id, trigger, status,
        summary_text, covered_until_entry_id, first_kept_entry_id, usage,
        error_code, error_message, started_at, completed_at
      ) VALUES (
        @compaction_id, @session_id, @anchor_entry_id, @trigger, @status,
        @summary_text, @covered_until_entry_id, @first_kept_entry_id, @usage,
        @error_code, @error_message, @started_at, @completed_at
      )
    `,
      })
      .run(toCompactionRow(compaction));
    return compaction;
  }

  /** Replaces only the lifecycle fields of an existing Compaction identity. */
  updateCompaction(compaction: SessionCompactionRecord): SessionCompactionRecord | undefined {
    const result = this.database
      .prepare({
        sql: `
      UPDATE session_compactions
      SET status = @status,
          summary_text = @summary_text,
          covered_until_entry_id = @covered_until_entry_id,
          first_kept_entry_id = @first_kept_entry_id,
          usage = @usage,
          error_code = @error_code,
          error_message = @error_message,
          completed_at = @completed_at
      WHERE compaction_id = @compaction_id
        AND session_id = @session_id
        AND anchor_entry_id = @anchor_entry_id
        AND trigger = @trigger
        AND started_at = @started_at
    `,
      })
      .run(toCompactionRow(compaction));
    return result.changes > 0 ? this.findCompactionById(compaction.compactionId) : undefined;
  }

  findCompactionById(compactionId: string): SessionCompactionRecord | undefined {
    const row = this.database
      .prepare<SessionCompactionRow>({
        sql: 'SELECT * FROM session_compactions WHERE compaction_id = ?',
      })
      .get([compactionId]);
    return row ? fromCompactionRow(row) : undefined;
  }

  listCompactionsBySessionId(sessionId: string): SessionCompactionRecord[] {
    return this.database
      .prepare<SessionCompactionRow>({
        sql: `
      SELECT * FROM session_compactions
      WHERE session_id = ?
      ORDER BY started_at ASC, compaction_id ASC
    `,
      })
      .all([sessionId])
      .map(fromCompactionRow);
  }

  listRunningCompactions(): SessionCompactionRecord[] {
    return this.database
      .prepare<SessionCompactionRow>({
        sql: `
      SELECT * FROM session_compactions
      WHERE status = 'running'
      ORDER BY started_at ASC, compaction_id ASC
    `,
      })
      .all()
      .map(fromCompactionRow);
  }

  listCompletedCompactionSummariesByIds(compactionIds: string[]): SessionCompactionSummary[] {
    if (compactionIds.length === 0) return [];
    const placeholders = compactionIds.map(() => '?').join(', ');
    return this.database
      .prepare<SessionCompactionRow>({
        sql: `
      SELECT * FROM session_compactions
      WHERE compaction_id IN (${placeholders})
        AND status = 'completed'
    `,
      })
      .all(compactionIds)
      .flatMap((row) => {
        const summary = fromCompactionRow(row).summary;
        return summary ? [summary] : [];
      });
  }
}

type SessionRow = DatabaseRow & {
  model_selection: string | null;
  session_id: string;
  workspace_id: string;
  title: string;
  status: Session['status'];
  active_entry_id: Nullable<string>;
  created_at: string;
  updated_at: string;
  archived_at: Nullable<string>;
};

type SessionMessageRow = DatabaseRow & {
  message_id: string;
  session_id: string;
  execution_id: Nullable<string>;
  message_kind: SessionMessageKind;
  message_json: string;
  created_at: string;
  completed_at: Nullable<string>;
};

type SessionMessageAttachmentRow = DatabaseRow & {
  attachment_id: string;
  message_id: string;
  session_id: string;
  type: SessionMessageAttachment['type'];
  name: Nullable<string>;
  mime_type: Nullable<string>;
  source_type: SessionMessageAttachment['source_type'];
  source_value: string;
  created_at: string;
  ordinal: number;
  size_bytes: Nullable<number>;
};

type SessionEntryRow = DatabaseRow & {
  entry_id: string;
  session_id: string;
  parent_entry_id: Nullable<string>;
  entry_type: Nullable<SessionEntry['entry_type']>;
  message_id: Nullable<string>;
  compaction_id: Nullable<string>;
  created_at: string;
};

type SessionCompactionRow = DatabaseRow & {
  compaction_id: string;
  session_id: string;
  anchor_entry_id: string;
  trigger: SessionCompactionRecord['trigger'];
  status: SessionCompactionRecord['status'];
  summary_text: Nullable<string>;
  covered_until_entry_id: Nullable<string>;
  first_kept_entry_id: Nullable<string>;
  usage: Nullable<string>;
  error_code: Nullable<string>;
  error_message: Nullable<string>;
  started_at: string;
  completed_at: Nullable<string>;
};

function toSessionRow(session: Session): SessionRow {
  return {
    model_selection: session.model_selection ? JSON.stringify(session.model_selection) : null,
    session_id: session.session_id,
    workspace_id: session.workspace_id,
    title: session.title,
    status: session.status,
    active_entry_id: session.active_entry_id ?? null,
    created_at: session.created_at,
    updated_at: session.updated_at,
    archived_at: session.archived_at ?? null,
  };
}

function fromSessionRow(row: SessionRow): Session {
  return {
    ...(row.model_selection
      ? { model_selection: SessionModelSelectionSchema.parse(JSON.parse(row.model_selection)) }
      : {}),
    session_id: row.session_id,
    workspace_id: row.workspace_id,
    title: row.title,
    status: row.status,
    ...(row.active_entry_id ? { active_entry_id: row.active_entry_id } : {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...(row.archived_at ? { archived_at: row.archived_at } : {}),
  };
}

function toMessageRow(message: SessionMessage): SessionMessageRow {
  return {
    message_id: message.message_id,
    session_id: message.session_id,
    execution_id: message.execution_id ?? null,
    message_kind: message.message_kind,
    message_json: JSON.stringify(toMessagePayload(message)),
    created_at: message.created_at,
    completed_at: message.completed_at ?? null,
  };
}

function fromMessageRow(row: SessionMessageRow): SessionMessage {
  const base = {
    message_id: row.message_id,
    session_id: row.session_id,
    ...(row.execution_id ? { execution_id: row.execution_id } : {}),
    created_at: row.created_at,
    ...(row.completed_at ? { completed_at: row.completed_at } : {}),
  };
  const payload = JSON.parse(row.message_json) as Record<string, unknown>;
  if (row.message_kind === 'user_message') {
    return {
      ...base,
      message_kind: row.message_kind,
      ...SessionUserMessagePayloadSchema.parse(normalizeLegacyUserMessagePayload(payload)),
    };
  }
  if (row.message_kind === 'model_response') {
    return {
      ...base,
      message_kind: row.message_kind,
      ...SessionModelResponsePayloadSchema.parse({
        ...payload,
        content: normalizeLegacyAssistantContent(payload.content as SessionAssistantContent[]),
      }),
    };
  }
  if (row.message_kind === 'tool_result') {
    return {
      ...base,
      message_kind: row.message_kind,
      ...SessionToolResultPayloadSchema.parse(payload),
    };
  }
  if (row.message_kind === 'assistant_reply') {
    return SessionAssistantReplyMessageSchema.parse({
      ...base,
      message_kind: row.message_kind,
      ...SessionAssistantReplyPayloadSchema.parse({
        ...payload,
        content: normalizeLegacyAssistantContent(payload.content as SessionAssistantContent[]),
      }),
    });
  }
  throw new Error(`Session message ${row.message_id} has unsupported message_kind.`);
}

function toMessagePayload(message: SessionMessage): Record<string, unknown> {
  if (message.message_kind === 'user_message') {
    return SessionUserMessagePayloadSchema.parse({
      display_content: message.display_content,
      model_content: message.model_content,
      ...(message.skill_selection ? { skill_selection: message.skill_selection } : {}),
      ...(message.legacy_provenance ? { legacy_provenance: message.legacy_provenance } : {}),
    });
  }
  if (message.message_kind === 'model_response') {
    return SessionModelResponsePayloadSchema.parse({
      content: message.content,
      outcome_status: message.outcome_status,
      ...(message.reason_code ? { reason_code: message.reason_code } : {}),
      ...(message.stop_reason ? { stop_reason: message.stop_reason } : {}),
      ...(message.api ? { api: message.api } : {}),
      ...(message.provider ? { provider: message.provider } : {}),
      ...(message.model ? { model: message.model } : {}),
      ...(message.response_model ? { response_model: message.response_model } : {}),
      ...(message.response_id ? { response_id: message.response_id } : {}),
      ...(message.usage ? { usage: message.usage } : {}),
      ...(message.failure ? { failure: message.failure } : {}),
      ...(message.error_message ? { error_message: message.error_message } : {}),
      ...(message.legacy_provenance ? { legacy_provenance: message.legacy_provenance } : {}),
    });
  }
  if (message.message_kind === 'tool_result') {
    return SessionToolResultPayloadSchema.parse({
      tool_call_id: message.tool_call_id,
      tool_name: message.tool_name,
      status: message.status,
      content: message.content,
      ...(message.error ? { error: message.error } : {}),
      ...(message.usage ? { usage: message.usage } : {}),
      ...(message.legacy_provenance ? { legacy_provenance: message.legacy_provenance } : {}),
    });
  }
  return SessionAssistantReplyPayloadSchema.parse({
    ...(message.memory_evidence ? { memory_evidence: message.memory_evidence } : {}),
    status: message.status,
    content: message.content,
    ...(message.reason_code ? { reason_code: message.reason_code } : {}),
    ...(message.api ? { api: message.api } : {}),
    ...(message.provider ? { provider: message.provider } : {}),
    ...(message.model ? { model: message.model } : {}),
    ...(message.response_model ? { response_model: message.response_model } : {}),
    ...(message.response_id ? { response_id: message.response_id } : {}),
    ...(message.usage ? { usage: message.usage } : {}),
    ...(message.error_message ? { error_message: message.error_message } : {}),
  });
}

function toAttachmentRow(attachment: SessionMessageAttachment): SessionMessageAttachmentRow {
  return {
    attachment_id: attachment.attachment_id,
    message_id: attachment.message_id,
    session_id: attachment.session_id,
    type: attachment.type,
    name: attachment.name ?? null,
    mime_type: attachment.mime_type ?? null,
    source_type: attachment.source_type,
    source_value: attachment.source_value,
    size_bytes: attachment.size_bytes ?? null,
    ordinal: attachment.ordinal,
    created_at: attachment.created_at,
  };
}

function fromAttachmentRow(row: SessionMessageAttachmentRow): SessionMessageAttachment {
  return {
    attachment_id: row.attachment_id,
    message_id: row.message_id,
    session_id: row.session_id,
    type: row.type,
    ...(row.name ? { name: row.name } : {}),
    ...(row.mime_type ? { mime_type: row.mime_type } : {}),
    source_type: row.source_type,
    source_value: row.source_value,
    ordinal: row.ordinal,
    ...(row.size_bytes !== null && row.size_bytes !== undefined
      ? { size_bytes: row.size_bytes }
      : {}),
    created_at: row.created_at,
  };
}

function toEntryRow(entry: SessionEntry): SessionEntryRow {
  return {
    entry_id: entry.entry_id,
    session_id: entry.session_id,
    parent_entry_id: entry.parent_entry_id ?? null,
    entry_type: entry.entry_type,
    message_id: entry.message_id ?? null,
    compaction_id: entry.compaction_id ?? null,
    created_at: entry.created_at,
  };
}

function fromEntryRow(row: SessionEntryRow): SessionEntry {
  return {
    entry_id: row.entry_id,
    session_id: row.session_id,
    ...(row.parent_entry_id ? { parent_entry_id: row.parent_entry_id } : {}),
    entry_type: row.entry_type as SessionEntry['entry_type'],
    ...(row.message_id ? { message_id: row.message_id } : {}),
    ...(row.compaction_id ? { compaction_id: row.compaction_id } : {}),
    created_at: row.created_at,
  };
}

function toCompactionRow(compaction: SessionCompactionRecord): SessionCompactionRow {
  const summary = compaction.summary;
  return {
    compaction_id: compaction.compactionId,
    session_id: compaction.sessionId,
    anchor_entry_id: compaction.anchorEntryId,
    trigger: compaction.trigger,
    status: compaction.status,
    summary_text: summary?.summary_text ?? null,
    covered_until_entry_id: summary?.covered_until_entry_id ?? null,
    first_kept_entry_id: summary?.first_kept_entry_id ?? null,
    usage: summary?.usage ? JSON.stringify(summary.usage) : null,
    error_code: compaction.error?.code ?? null,
    error_message: compaction.error?.message ?? null,
    started_at: compaction.startedAt,
    completed_at: compaction.completedAt ?? null,
  };
}

function fromCompactionRow(row: SessionCompactionRow): SessionCompactionRecord {
  const summary =
    row.status === 'completed' && row.summary_text && row.covered_until_entry_id
      ? {
          compaction_id: row.compaction_id,
          session_id: row.session_id,
          summary_text: row.summary_text,
          covered_until_entry_id: row.covered_until_entry_id,
          ...(row.first_kept_entry_id ? { first_kept_entry_id: row.first_kept_entry_id } : {}),
          ...(row.usage ? { usage: JSON.parse(row.usage) as unknown } : {}),
          created_at: row.completed_at ?? row.started_at,
        }
      : undefined;
  return {
    compactionId: row.compaction_id,
    sessionId: row.session_id,
    anchorEntryId: row.anchor_entry_id,
    trigger: row.trigger,
    status: row.status,
    ...(summary ? { summary } : {}),
    ...(row.error_code && row.error_message
      ? { error: { code: row.error_code, message: row.error_message } }
      : {}),
    startedAt: row.started_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
  };
}

/** Writes images atomically and rejects references escaping the managed directory. */
export function createSessionAttachmentFileStore(input: {
  attachmentsPath: string;
  fileSystem: SessionAttachmentFileSystem;
}): SessionAttachmentContentStore {
  const root = path.resolve(input.attachmentsPath);
  const resolveReference = (referenceId: string) => {
    const resolved = path.resolve(root, referenceId);
    const relative = path.relative(root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Attachment reference escapes the managed root.');
    }
    return resolved;
  };

  return {
    async write(request) {
      const extension = extensionFor(request.mediaType);
      const storageKey = storageKeyForAttachmentId(request.attachmentId);
      const referenceId = `${storageKey}/original.${extension}`;
      const finalPath = resolveReference(referenceId);
      const directoryPath = path.dirname(finalPath);
      const temporaryPath = `${finalPath}.tmp-${crypto.randomUUID()}`;
      await input.fileSystem.ensureDirectory(directoryPath);
      try {
        await input.fileSystem.writeFile(temporaryPath, request.bytes);
        await input.fileSystem.moveFile(temporaryPath, finalPath);
      } catch (error) {
        await input.fileSystem.removeFile(temporaryPath).catch(() => undefined);
        throw error;
      }
      return { referenceId };
    },
    async read(referenceId) {
      return input.fileSystem.readFile(resolveReference(referenceId));
    },
    async delete(referenceId) {
      return input.fileSystem.removeFile(resolveReference(referenceId));
    },
  };
}

function storageKeyForAttachmentId(attachmentId: string): string {
  const storageKey = attachmentId.startsWith('attachment:')
    ? attachmentId.slice('attachment:'.length)
    : attachmentId;
  if (!storageKey || storageKey === '.' || storageKey === '..' || !/^[A-Za-z0-9._-]+$/.test(storageKey)) {
    throw new Error('Attachment ID cannot be mapped to a managed storage path.');
  }
  return storageKey;
}

function extensionFor(mediaType: SupportedSessionImageMediaType): 'png' | 'jpg' | 'webp' {
  if (mediaType === 'image/png') return 'png';
  if (mediaType === 'image/jpeg') return 'jpg';
  return 'webp';
}
