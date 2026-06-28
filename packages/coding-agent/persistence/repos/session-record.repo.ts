// Owns persisted Coding Agent session records.
import type { MegumiDatabase } from '../connection';
import type { JsonObject } from '@megumi/shared/primitives';
import type { Session } from '@megumi/shared/session';

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

export class SessionRecordRepository {
  constructor(private readonly database: MegumiDatabase) {}

  saveSession(session: Session): Session {
    this.database.prepare(`
      INSERT INTO sessions (
        session_id, title, workspace_id, workspace_path, status, created_at, updated_at,
        archived_at, summary, metadata_json
      ) VALUES (
        @session_id, @title, @workspace_id, @workspace_path, @status, @created_at, @updated_at,
        @archived_at, @summary, @metadata_json
      )
      ON CONFLICT(session_id) DO UPDATE SET
        title = excluded.title,
        workspace_id = excluded.workspace_id,
        workspace_path = excluded.workspace_path,
        status = excluded.status,
        updated_at = excluded.updated_at,
        archived_at = excluded.archived_at,
        summary = excluded.summary,
        metadata_json = excluded.metadata_json
    `).run(toSessionRow(session));

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
    metadata_json: session.metadata ? stringifyJson(session.metadata) : null,
  };
}

function fromSessionRow(row: SessionRow): Session {
  return {
    sessionId: row.session_id,
    title: row.title,
    ...(row.workspace_id ? { workspaceId: row.workspace_id } : {}),
    ...(row.workspace_path ? { workspacePath: row.workspace_path } : {}),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.archived_at ? { archivedAt: row.archived_at } : {}),
    ...(row.summary ? { summary: row.summary } : {}),
    ...(row.metadata_json ? { metadata: parseJson<JsonObject>(row.metadata_json) } : {}),
  };
}
