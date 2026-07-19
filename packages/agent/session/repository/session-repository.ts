/*
 * Provides Session-owned database access. This is the module's Mapper /
 * Repository layer, not a public service and not a persistence owner.
 */
import type { MegumiDatabase } from '../../persistence/connection';
import type {
  Session,
} from '../domain/model/session';
import type { SessionCompactionSummary, SessionEntry } from '../domain/model/session-entry';
import type { SessionMessageAttachment } from '../domain/model/session-attachment';
import type { SessionMessage, SessionMessageKind } from '../domain/model/session-message';
import {
  SessionAssistantReplyMessageSchema,
  SessionAssistantReplyPayloadSchema,
  SessionModelResponsePayloadSchema,
  SessionToolResultPayloadSchema,
  SessionUserMessagePayloadSchema,
} from '../domain/model/session-message';

type Nullable<T> = T | null;

export class SessionRepository {
  constructor(private readonly database: MegumiDatabase) {}

  runInTransaction<T>(operation: () => T): T {
    return this.database.transaction(operation)();
  }

  insertSession(session: Session): Session {
    this.database.prepare(`
      INSERT INTO sessions (
        session_id, workspace_id, title, status, active_entry_id,
        created_at, updated_at, archived_at
      ) VALUES (
        @session_id, @workspace_id, @title, @status, @active_entry_id,
        @created_at, @updated_at, @archived_at
      )
    `).run(toSessionRow(session));
    return session;
  }

  findSessionById(sessionId: string): Session | undefined {
    const row = this.database.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId) as SessionRow | undefined;
    return row ? fromSessionRow(row) : undefined;
  }

  listSessionsByWorkspaceId(workspaceId: string): Session[] {
    return (this.database.prepare(`
      SELECT * FROM sessions
      WHERE workspace_id = ?
      ORDER BY updated_at DESC
    `).all(workspaceId) as SessionRow[]).map(fromSessionRow);
  }

  updateSessionArchiveState(input: { session_id: string; archived_at: string }): Session | undefined {
    this.database.prepare(`
      UPDATE sessions
      SET status = 'archived',
          archived_at = @archived_at,
          updated_at = @archived_at
      WHERE session_id = @session_id
    `).run(input);
    return this.findSessionById(input.session_id);
  }

  insertMessage(message: SessionMessage): SessionMessage {
    this.database.prepare(`
      INSERT INTO session_messages (
        message_id, session_id, run_id, message_kind, message_json,
        created_at, completed_at
      ) VALUES (
        @message_id, @session_id, @run_id, @message_kind, @message_json,
        @created_at, @completed_at
      )
    `).run(toMessageRow(message));
    return message;
  }

  findMessageById(messageId: string): SessionMessage | undefined {
    const row = this.database.prepare('SELECT * FROM session_messages WHERE message_id = ?').get(messageId) as SessionMessageRow | undefined;
    return row ? fromMessageRow(row) : undefined;
  }

  listMessagesBySessionId(sessionId: string): SessionMessage[] {
    return (this.database.prepare(`
      SELECT * FROM session_messages
      WHERE session_id = ?
      ORDER BY created_at ASC, message_id ASC
    `).all(sessionId) as SessionMessageRow[]).map(fromMessageRow);
  }

  listMessagesByRunId(sessionId: string, runId: string): SessionMessage[] {
    return (this.database.prepare(`
      SELECT * FROM session_messages
      WHERE session_id = ? AND run_id = ?
      ORDER BY created_at ASC, message_id ASC
    `).all(sessionId, runId) as SessionMessageRow[]).map(fromMessageRow);
  }

  findAssistantReplyByRunId(sessionId: string, runId: string): SessionMessage | undefined {
    const row = this.database.prepare(`
      SELECT * FROM session_messages
      WHERE session_id = ? AND run_id = ? AND message_kind = 'assistant_reply'
      LIMIT 1
    `).get(sessionId, runId) as SessionMessageRow | undefined;
    return row ? fromMessageRow(row) : undefined;
  }

  listUserMessagesByRunIds(runIds: string[]): SessionMessage[] {
    if (runIds.length === 0) {
      return [];
    }
    const placeholders = runIds.map(() => '?').join(', ');
    return (this.database.prepare(`
      SELECT * FROM session_messages
      WHERE run_id IN (${placeholders}) AND message_kind = 'user_message'
      ORDER BY created_at ASC, message_id ASC
    `).all(...runIds) as SessionMessageRow[]).map(fromMessageRow);
  }

  listMessagesByIds(messageIds: string[]): SessionMessage[] {
    if (messageIds.length === 0) {
      return [];
    }
    const placeholders = messageIds.map(() => '?').join(', ');
    return (this.database.prepare(`
      SELECT * FROM session_messages
      WHERE message_id IN (${placeholders})
    `).all(...messageIds) as SessionMessageRow[]).map(fromMessageRow);
  }

  insertMessageAttachments(attachments: SessionMessageAttachment[]): void {
    const insert = this.database.prepare(`
      INSERT INTO session_message_attachments (
        attachment_id, message_id, session_id, type, name, mime_type,
        source_type, source_value, created_at
      ) VALUES (
        @attachment_id, @message_id, @session_id, @type, @name, @mime_type,
        @source_type, @source_value, @created_at
      )
    `);
    this.database.transaction((items: SessionMessageAttachment[]) => {
      for (const item of items) {
        insert.run(toAttachmentRow(item));
      }
    })(attachments);
  }

  listAttachmentsByMessageIds(messageIds: string[]): SessionMessageAttachment[] {
    if (messageIds.length === 0) {
      return [];
    }
    const placeholders = messageIds.map(() => '?').join(', ');
    return (this.database.prepare(`
      SELECT * FROM session_message_attachments
      WHERE message_id IN (${placeholders})
      ORDER BY created_at ASC, attachment_id ASC
    `).all(...messageIds) as SessionMessageAttachmentRow[]).map(fromAttachmentRow);
  }

  findAttachmentById(attachmentId: string): SessionMessageAttachment | undefined {
    const row = this.database.prepare('SELECT * FROM session_message_attachments WHERE attachment_id = ?').get(attachmentId) as SessionMessageAttachmentRow | undefined;
    return row ? fromAttachmentRow(row) : undefined;
  }

  insertEntry(entry: SessionEntry): SessionEntry {
    this.database.prepare(`
      INSERT INTO session_entries (
        entry_id, session_id, parent_entry_id, entry_type,
        message_id, compaction_id, created_at
      ) VALUES (
        @entry_id, @session_id, @parent_entry_id, @entry_type,
        @message_id, @compaction_id, @created_at
      )
    `).run(toEntryRow(entry));
    return entry;
  }

  findEntryById(entryId: string): SessionEntry | undefined {
    const row = this.database.prepare('SELECT * FROM session_entries WHERE entry_id = ?').get(entryId) as SessionEntryRow | undefined;
    return row ? fromEntryRow(row) : undefined;
  }

  findMessageEntry(input: { session_id: string; message_id: string }): SessionEntry | undefined {
    const row = this.database.prepare(`
      SELECT * FROM session_entries
      WHERE session_id = @session_id
        AND message_id = @message_id
        AND entry_type = 'message'
    `).get(input) as SessionEntryRow | undefined;
    return row ? fromEntryRow(row) : undefined;
  }

  listEntriesBySessionId(sessionId: string): SessionEntry[] {
    return (this.database.prepare(`
      SELECT * FROM session_entries
      WHERE session_id = ?
      ORDER BY created_at ASC, entry_id ASC
    `).all(sessionId) as SessionEntryRow[]).map(fromEntryRow);
  }

  updateEntryParent(input: { entry_id: string; parent_entry_id?: string }): SessionEntry | undefined {
    this.database.prepare(`
      UPDATE session_entries
      SET parent_entry_id = @parent_entry_id
      WHERE entry_id = @entry_id
    `).run({ entry_id: input.entry_id, parent_entry_id: input.parent_entry_id ?? null });
    return this.findEntryById(input.entry_id);
  }

  updateActiveEntry(input: { session_id: string; active_entry_id?: string; updated_at: string }): Session | undefined {
    this.database.prepare(`
      UPDATE sessions
      SET active_entry_id = @active_entry_id,
          updated_at = @updated_at
      WHERE session_id = @session_id
    `).run({
      session_id: input.session_id,
      active_entry_id: input.active_entry_id ?? null,
      updated_at: input.updated_at,
    });
    return this.findSessionById(input.session_id);
  }

  insertCompactionSummary(compaction: SessionCompactionSummary): SessionCompactionSummary {
    this.database.prepare(`
      INSERT INTO session_compactions (
        compaction_id, session_id, summary_text, covered_until_entry_id,
        first_kept_entry_id, created_at
      ) VALUES (
        @compaction_id, @session_id, @summary_text, @covered_until_entry_id,
        @first_kept_entry_id, @created_at
      )
    `).run(toCompactionRow(compaction));
    return compaction;
  }

  findCompactionSummaryById(compactionId: string): SessionCompactionSummary | undefined {
    const row = this.database.prepare('SELECT * FROM session_compactions WHERE compaction_id = ?').get(compactionId) as SessionCompactionRow | undefined;
    return row ? fromCompactionRow(row) : undefined;
  }

  listCompactionSummariesByIds(compactionIds: string[]): SessionCompactionSummary[] {
    if (compactionIds.length === 0) {
      return [];
    }
    const placeholders = compactionIds.map(() => '?').join(', ');
    return (this.database.prepare(`
      SELECT * FROM session_compactions
      WHERE compaction_id IN (${placeholders})
    `).all(...compactionIds) as SessionCompactionRow[]).map(fromCompactionRow);
  }

  listCompactionSummariesBySessionId(sessionId: string): SessionCompactionSummary[] {
    return (this.database.prepare(`
      SELECT * FROM session_compactions
      WHERE session_id = ?
      ORDER BY created_at ASC, compaction_id ASC
    `).all(sessionId) as SessionCompactionRow[]).map(fromCompactionRow);
  }
}

type SessionRow = {
  session_id: string;
  workspace_id: string;
  title: string;
  status: Session['status'];
  active_entry_id: Nullable<string>;
  created_at: string;
  updated_at: string;
  archived_at: Nullable<string>;
};

type SessionMessageRow = {
  message_id: string;
  session_id: string;
  run_id: Nullable<string>;
  message_kind: SessionMessageKind;
  message_json: string;
  created_at: string;
  completed_at: Nullable<string>;
};

type SessionMessageAttachmentRow = {
  attachment_id: string;
  message_id: string;
  session_id: string;
  type: SessionMessageAttachment['type'];
  name: Nullable<string>;
  mime_type: Nullable<string>;
  source_type: SessionMessageAttachment['source_type'];
  source_value: string;
  created_at: string;
};

type SessionEntryRow = {
  entry_id: string;
  session_id: string;
  parent_entry_id: Nullable<string>;
  entry_type: Nullable<SessionEntry['entry_type']>;
  message_id: Nullable<string>;
  compaction_id: Nullable<string>;
  created_at: string;
};

type SessionCompactionRow = {
  compaction_id: string;
  session_id: string;
  summary_text: string;
  covered_until_entry_id: string;
  first_kept_entry_id: Nullable<string>;
  created_at: string;
};

function toSessionRow(session: Session): SessionRow {
  return {
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
    run_id: message.run_id ?? null,
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
    ...(row.run_id ? { run_id: row.run_id } : {}),
    created_at: row.created_at,
    ...(row.completed_at ? { completed_at: row.completed_at } : {}),
  };
  const payload = JSON.parse(row.message_json) as unknown;
  if (row.message_kind === 'user_message') {
    return { ...base, message_kind: row.message_kind, ...SessionUserMessagePayloadSchema.parse(payload) };
  }
  if (row.message_kind === 'model_response') {
    return { ...base, message_kind: row.message_kind, ...SessionModelResponsePayloadSchema.parse(payload) };
  }
  if (row.message_kind === 'tool_result') {
    return { ...base, message_kind: row.message_kind, ...SessionToolResultPayloadSchema.parse(payload) };
  }
  if (row.message_kind === 'assistant_reply') {
    return SessionAssistantReplyMessageSchema.parse({
      ...base,
      message_kind: row.message_kind,
      ...SessionAssistantReplyPayloadSchema.parse(payload),
    });
  }
  throw new Error(`Session message ${row.message_id} has unsupported message_kind.`);
}

function toMessagePayload(message: SessionMessage): Record<string, unknown> {
  if (message.message_kind === 'user_message') {
    return SessionUserMessagePayloadSchema.parse({
      content: message.content,
      ...(message.legacy_provenance ? { legacy_provenance: message.legacy_provenance } : {}),
    });
  }
  if (message.message_kind === 'model_response') {
    return SessionModelResponsePayloadSchema.parse({
      content: message.content,
      outcome_status: message.outcome_status,
      ...(message.reason_code ? { reason_code: message.reason_code } : {}),
      ...(message.stop_reason ? { stop_reason: message.stop_reason } : {}),
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
      ...(message.legacy_provenance ? { legacy_provenance: message.legacy_provenance } : {}),
    });
  }
  return SessionAssistantReplyPayloadSchema.parse({
    status: message.status,
    content: message.content,
    ...(message.reason_code ? { reason_code: message.reason_code } : {}),
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

function toCompactionRow(compaction: SessionCompactionSummary): SessionCompactionRow {
  return {
    compaction_id: compaction.compaction_id,
    session_id: compaction.session_id,
    summary_text: compaction.summary_text,
    covered_until_entry_id: compaction.covered_until_entry_id,
    first_kept_entry_id: compaction.first_kept_entry_id ?? null,
    created_at: compaction.created_at,
  };
}

function fromCompactionRow(row: SessionCompactionRow): SessionCompactionSummary {
  return {
    compaction_id: row.compaction_id,
    session_id: row.session_id,
    summary_text: row.summary_text,
    covered_until_entry_id: row.covered_until_entry_id,
    ...(row.first_kept_entry_id ? { first_kept_entry_id: row.first_kept_entry_id } : {}),
    created_at: row.created_at,
  };
}
