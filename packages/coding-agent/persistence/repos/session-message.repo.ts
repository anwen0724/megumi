// Owns persisted session message history records for Coding Agent sessions.
import type { MegumiDatabase } from '../connection';
import type { JsonObject } from '@megumi/shared/primitives';
import type { SessionMessage } from '@megumi/shared/session';

type Nullable<T> = T | null;

interface SessionMessageRow {
  message_id: string;
  session_id: string;
  run_id: Nullable<string>;
  role: SessionMessage['role'];
  content: string;
  status: SessionMessage['status'];
  created_at: string;
  completed_at: Nullable<string>;
  metadata_json: Nullable<string>;
}

export class SessionMessageRepository {
  constructor(private readonly database: MegumiDatabase) {}

  saveMessage(message: SessionMessage): SessionMessage {
    this.database.prepare(`
      INSERT INTO session_messages (
        message_id, session_id, run_id, role, content, status, created_at, completed_at, metadata_json
      ) VALUES (
        @message_id, @session_id, @run_id, @role, @content, @status, @created_at, @completed_at, @metadata_json
      )
      ON CONFLICT(message_id) DO UPDATE SET
        run_id = excluded.run_id,
        content = excluded.content,
        status = excluded.status,
        completed_at = excluded.completed_at,
        metadata_json = excluded.metadata_json
    `).run(toSessionMessageRow(message));

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
    content: message.content,
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
    content: row.content,
    status: row.status,
    createdAt: row.created_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    ...(row.metadata_json ? { metadata: parseJson<JsonObject>(row.metadata_json) } : {}),
  };
}
